import type { Duplex } from 'node:stream';
import type { Logger } from '../lib/logger.js';
import { AppError, SandboxUnavailableError } from '../lib/errors.js';
import type { SandboxKind } from '../types.js';
import type { ExecResult, SandboxProvider, SandboxStatus, ScreenMode } from './types.js';

export interface OrchestratorOptions {
  mode: 'auto' | 'docker' | 'subprocess';
  idleMinutes: number;
  execTimeoutMs: number;
  reaperIntervalMs?: number;
}

/**
 * Owns every bot sandbox: chooses the provider, provisions/tears down, routes exec calls to
 * exactly one bot's sandbox, reaps idle containers, heals unhealthy ones, reconciles on boot.
 */
export class Orchestrator {
  private activeKind: SandboxKind = 'subprocess';
  private lastActivity = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private dockerUp = false;

  constructor(
    private providers: { docker?: SandboxProvider; subprocess: SandboxProvider },
    private opts: OrchestratorOptions,
    private log: Logger,
  ) {}

  /** Decide which provider new bots get. */
  async init(): Promise<SandboxKind> {
    const docker = this.providers.docker;
    this.dockerUp = !!docker && (await docker.available());
    if (this.opts.mode === 'subprocess') this.activeKind = 'subprocess';
    else if (this.opts.mode === 'docker') this.activeKind = 'docker';
    else this.activeKind = this.dockerUp ? 'docker' : 'subprocess';

    if (this.opts.mode === 'docker' && !this.dockerUp) {
      this.log.warn('SANDBOX_MODE=docker but Docker is not reachable: bot creation will fail until Docker is running');
    }
    if (this.activeKind === 'subprocess') {
      this.log.warn('Sandbox DEMO MODE (subprocess): commands are NOT isolated. Use Docker for production.');
    }
    this.log.info({ sandbox: this.activeKind, dockerReachable: this.dockerUp }, 'orchestrator ready');
    return this.activeKind;
  }

  get defaultKind(): SandboxKind {
    return this.activeKind;
  }

  provider(kind: SandboxKind | null | undefined): SandboxProvider {
    const k = kind ?? this.activeKind;
    const p = k === 'docker' ? this.providers.docker : this.providers.subprocess;
    if (!p) throw new SandboxUnavailableError(`Sandbox provider "${k}" is not configured`);
    return p;
  }

  async provision(botId: string): Promise<{ kind: SandboxKind; ref: string }> {
    const p = this.provider(this.activeKind);
    const { ref } = await p.provision(botId);
    this.lastActivity.set(botId, Date.now());
    return { kind: p.kind, ref };
  }

  async teardown(botId: string, kind: SandboxKind | null) {
    this.lastActivity.delete(botId);
    const kinds: SandboxKind[] = kind ? [kind] : ['docker', 'subprocess'];
    for (const k of kinds) {
      const p = k === 'docker' ? this.providers.docker : this.providers.subprocess;
      if (!p) continue;
      if (k === 'docker' && !(await p.available())) {
        this.log.warn({ botId }, 'Docker unreachable during teardown; orphan will be removed on next reconcile');
        continue;
      }
      await p.teardown(botId);
    }
  }

  async exec(botId: string, kind: SandboxKind | null, command: string): Promise<ExecResult> {
    this.lastActivity.set(botId, Date.now());
    const result = await this.provider(kind).exec(botId, command, { timeoutMs: this.opts.execTimeoutMs });
    this.lastActivity.set(botId, Date.now());
    return result;
  }

  async ensureRunning(botId: string, kind: SandboxKind | null) {
    this.lastActivity.set(botId, Date.now());
    await this.provider(kind).ensureRunning(botId);
  }

  async status(botId: string, kind: SandboxKind | null): Promise<SandboxStatus> {
    return this.provider(kind).status(botId);
  }

  async openVnc(botId: string, kind: SandboxKind | null, mode: ScreenMode): Promise<Duplex> {
    const p = this.provider(kind);
    if (!p.supportsScreen || !p.openVncStream) {
      throw new AppError(501, 'screen_unsupported', 'Screen sharing needs Docker sandboxes (not available in demo mode).');
    }
    this.lastActivity.set(botId, Date.now());
    return p.openVncStream(botId, mode);
  }

  touch(botId: string) {
    this.lastActivity.set(botId, Date.now());
  }

  /**
   * Startup reconcile: remove sandboxes whose bot no longer exists, and report which known bots
   * have lost their sandbox (they will be lazily re-provisioned on next use).
   */
  async reconcile(knownBots: { id: string; kind: SandboxKind | null }[]): Promise<{ removed: string[]; missing: string[] }> {
    const known = new Set(knownBots.map((b) => b.id));
    const removed: string[] = [];
    const missing: string[] = [];
    for (const p of [this.providers.docker, this.providers.subprocess]) {
      if (!p || !(await p.available())) continue;
      for (const id of await p.listManaged()) {
        if (!known.has(id)) {
          await p.teardown(id).catch((err) => this.log.warn({ err, botId: id }, 'orphan teardown failed'));
          removed.push(id);
        }
      }
      for (const b of knownBots.filter((x) => x.kind === p.kind)) {
        const st = await p.status(b.id).catch(() => undefined);
        if (st?.state === 'missing') missing.push(b.id);
        if (st?.state === 'running') this.lastActivity.set(b.id, Date.now());
      }
    }
    this.log.info({ removed: removed.length, missing: missing.length }, 'sandbox reconcile complete');
    return { removed, missing };
  }

  /** Stop idle docker sandboxes and restart unhealthy ones. Returns stopped bot ids. */
  async reapOnce(now = Date.now()): Promise<string[]> {
    const docker = this.providers.docker;
    if (!docker || !(await docker.available())) return [];
    const idleMs = this.opts.idleMinutes * 60_000;
    const stopped: string[] = [];
    for (const [botId, at] of this.lastActivity) {
      const st = await docker.status(botId).catch(() => undefined);
      if (!st || st.state !== 'running') {
        if (st?.state !== 'stopped') this.lastActivity.delete(botId);
        continue;
      }
      if (now - at > idleMs) {
        await docker.stop(botId).catch((err) => this.log.warn({ err, botId }, 'idle stop failed'));
        this.lastActivity.delete(botId);
        stopped.push(botId);
        this.log.info({ botId }, 'stopped idle sandbox');
      } else if (st.health === 'unhealthy') {
        this.log.warn({ botId }, 'sandbox unhealthy, restarting');
        await docker.stop(botId).catch(() => undefined);
        await docker.ensureRunning(botId).catch((err) => this.log.error({ err, botId }, 'restart failed'));
      }
    }
    return stopped;
  }

  startBackgroundTasks() {
    const every = this.opts.reaperIntervalMs ?? 60_000;
    this.timer = setInterval(() => {
      this.reapOnce().catch((err) => this.log.error({ err }, 'reaper failed'));
    }, every);
    this.timer.unref();
  }

  async health() {
    const dockerReachable = this.providers.docker ? await this.providers.docker.available() : false;
    return { mode: this.opts.mode, defaultKind: this.activeKind, dockerReachable, tracked: this.lastActivity.size };
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
