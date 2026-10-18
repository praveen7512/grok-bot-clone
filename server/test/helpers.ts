import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { openDb, type DB } from '../src/db.js';
import { MockLlmClient } from '../src/llm/mockClient.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { SubprocessProvider } from '../src/orchestrator/subprocessProvider.js';
import type { SandboxProvider } from '../src/orchestrator/types.js';
import { BotRepository } from '../src/repositories/botRepository.js';
import { MemoryRepository } from '../src/repositories/memoryRepository.js';
import { MessageRepository } from '../src/repositories/messageRepository.js';
import { AuthService } from '../src/services/authService.js';
import { BotService } from '../src/services/botService.js';
import { ChatService, type ChatEvent } from '../src/services/chatService.js';
import { ContextService } from '../src/services/contextService.js';
import { MemoryService } from '../src/services/memoryService.js';
import { ScreenService } from '../src/services/screenService.js';

export const silentLog = pino({ level: 'silent' });

export function tmpDir(prefix = 'botclone-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function makeStack(opts: { dbFile?: string; docker?: SandboxProvider; mode?: 'auto' | 'docker' | 'subprocess'; maxMessages?: number; keepMessages?: number } = {}) {
  const dir = tmpDir();
  const db: DB = openDb(opts.dbFile ?? path.join(dir, 'test.db'));
  const llm = new MockLlmClient();
  const subprocess = new SubprocessProvider(path.join(dir, 'sandboxes'), silentLog);
  const orchestrator = new Orchestrator(
    { docker: opts.docker, subprocess },
    { mode: opts.mode ?? 'subprocess', idleMinutes: 30, execTimeoutMs: 10_000 },
    silentLog,
  );
  await orchestrator.init();
  const bots = new BotService(new BotRepository(db), orchestrator, silentLog);
  const messages = new MessageRepository(db);
  const context = new ContextService(messages, silentLog, { maxMessages: opts.maxMessages ?? 40, keepMessages: opts.keepMessages ?? 16 });
  const memoryRepo = new MemoryRepository(db);
  const memory = new MemoryService(memoryRepo);
  const screen = new ScreenService({ secret: 'test-secret', ttlSeconds: 600 });
  const auth = new AuthService({ password: 'pw', secret: 'test-secret', sessionTtlHours: 1 });
  const chat = new ChatService({ bots, context, memory, orchestrator, screen, llm, log: silentLog, maxSteps: 6 });
  return { dir, db, llm, subprocess, orchestrator, bots, messages, context, memoryRepo, memory, screen, auth, chat };
}

export async function say(chat: ChatService, botId: string, text: string) {
  const events: ChatEvent[] = [];
  await chat.runTurn(botId, text, (e) => events.push(e));
  const reply = events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('');
  return { events, reply };
}

/** In-memory stand-in for dockerode, recording every call. */
export class FakeDocker {
  up = true;
  images = new Set<string>(['botclone-sandbox:latest']);
  networks = new Set<string>();
  volumes = new Set<string>();
  containers = new Map<string, { id: string; opts: any; running: boolean; health?: string }>();
  calls: string[] = [];
  failCreate = false;
  modem = {
    followProgress: (_s: unknown, cb: (e: unknown) => void) => cb(null),
    demuxStream: () => undefined,
  };

  private nf() { return Object.assign(new Error('not found'), { statusCode: 404 }); }

  async ping() { if (!this.up) throw new Error('ECONNREFUSED'); return 'OK'; }
  getImage(name: string) { return { inspect: async () => { if (!this.images.has(name)) throw this.nf(); return {}; } }; }
  async pull() { throw new Error('pull denied'); }
  getNetwork(name: string) { return { inspect: async () => { if (!this.networks.has(name)) throw this.nf(); return {}; } }; }
  async createNetwork(o: any) { this.calls.push(`createNetwork:${o.Name}:internal=${o.Internal}`); this.networks.add(o.Name); }
  async createVolume(o: any) { this.calls.push(`createVolume:${o.Name}`); this.volumes.add(o.Name); }
  getVolume(name: string) { return { remove: async () => { if (!this.volumes.delete(name)) throw this.nf(); this.calls.push(`removeVolume:${name}`); } }; }
  async createContainer(opts: any) {
    this.calls.push(`createContainer:${opts.name}`);
    if (this.failCreate) throw new Error('simulated create failure');
    const c = { id: `cid-${opts.name}`, opts, running: false };
    this.containers.set(opts.name, c);
    return { id: c.id, start: async () => { c.running = true; } };
  }
  getContainer(name: string) {
    return {
      inspect: async () => {
        const c = this.containers.get(name);
        if (!c) throw this.nf();
        return { State: { Running: c.running, Paused: false, Health: c.health ? { Status: c.health } : undefined } };
      },
      start: async () => { const c = this.containers.get(name); if (!c) throw this.nf(); c.running = true; this.calls.push(`start:${name}`); },
      stop: async () => { const c = this.containers.get(name); if (!c) throw this.nf(); c.running = false; this.calls.push(`stop:${name}`); },
      unpause: async () => undefined,
      remove: async () => { if (!this.containers.delete(name)) throw this.nf(); this.calls.push(`removeContainer:${name}`); },
    };
  }
  async listContainers() {
    return [...this.containers.values()].map((c) => ({ Labels: c.opts.Labels }));
  }
}
