import crypto from 'node:crypto';
import type { Logger } from '../lib/logger.js';
import { AppError, SandboxUnavailableError, notFound } from '../lib/errors.js';
import type { Orchestrator } from '../orchestrator/orchestrator.js';
import type { BotRepository } from '../repositories/botRepository.js';
import type { Bot } from '../types.js';

export interface CreateBotInput {
  name: string;
  persona?: string;
  voice?: Partial<Bot['voice']>;
}

export interface UpdateBotInput {
  name?: string;
  persona?: string;
  voice?: Partial<Bot['voice']>;
}

export class BotService {
  constructor(private bots: BotRepository, private orchestrator: Orchestrator, private log: Logger) {}

  list(): Bot[] {
    return this.bots.list();
  }

  get(id: string): Bot {
    const b = this.bots.get(id);
    if (!b) throw notFound('Bot');
    return b;
  }

  /**
   * Atomic create: DB row (status=provisioning) -> sandbox provision -> status=ready.
   * Context, memory namespace and voice settings are keyed by the bot id, so they exist the moment
   * the row exists and disappear with it. If provisioning fails, the partial sandbox is torn down
   * and the row deleted (cascade), so no half-created bot survives.
   */
  async create(input: CreateBotInput): Promise<Bot> {
    const id = crypto.randomUUID();
    this.bots.insert({
      id,
      name: input.name.trim(),
      persona: input.persona?.trim() ?? '',
      voice: { enabled: input.voice?.enabled ?? false, name: input.voice?.name ?? null, rate: input.voice?.rate ?? 1 },
    });
    this.log.info({ botId: id, name: input.name }, 'bot created, provisioning sandbox');
    try {
      const { kind, ref } = await this.orchestrator.provision(id);
      const bot = this.bots.update(id, { status: 'ready', sandboxKind: kind, sandboxRef: ref })!;
      this.log.info({ botId: id, sandbox: kind }, 'bot ready');
      return bot;
    } catch (err) {
      this.log.error({ err, botId: id }, 'provisioning failed, rolling back');
      await this.orchestrator.teardown(id, null).catch((e) => this.log.warn({ err: e, botId: id }, 'rollback teardown failed'));
      this.bots.delete(id);
      if (err instanceof AppError) throw err;
      throw new SandboxUnavailableError(`Could not provision the bot's sandbox: ${(err as Error).message}`);
    }
  }

  update(id: string, input: UpdateBotInput): Bot {
    const bot = this.get(id);
    return this.bots.update(id, {
      name: input.name?.trim(),
      persona: input.persona?.trim(),
      voice: input.voice ? { ...bot.voice, ...input.voice } : undefined,
    })!;
  }

  async delete(id: string): Promise<void> {
    const bot = this.get(id);
    await this.orchestrator.teardown(id, bot.sandboxKind);
    this.bots.delete(id);
    this.log.info({ botId: id }, 'bot deleted');
  }

  setStatus(id: string, status: Bot['status']) {
    this.bots.update(id, { status });
  }

  touch(id: string) {
    this.bots.touch(id);
  }

  /** Boot-time recovery: roll back half-provisioned bots, reconcile sandboxes. */
  async recoverOnStartup() {
    for (const b of this.bots.list().filter((x) => x.status === 'provisioning')) {
      this.log.warn({ botId: b.id }, 'found bot stuck in provisioning, rolling back');
      await this.orchestrator.teardown(b.id, null).catch(() => undefined);
      this.bots.delete(b.id);
    }
    const bots = this.bots.list();
    const { missing } = await this.orchestrator.reconcile(bots.map((b) => ({ id: b.id, kind: b.sandboxKind })));
    for (const id of missing) this.bots.update(id, { status: 'stopped' });
  }
}
