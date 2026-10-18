import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../lib/logger.js';
import { capOutput, type ExecResult, type SandboxProvider, type SandboxStatus } from './types.js';

/**
 * DEMO MODE sandbox: one working directory per bot, commands run as a child process with a
 * scrubbed environment, ulimits and a timeout. This is NOT a security boundary; it exists so a
 * live demo works on hosts without Docker (most PaaS). Use Docker mode for real isolation.
 */
export class SubprocessProvider implements SandboxProvider {
  readonly kind = 'subprocess' as const;
  readonly supportsScreen = false;

  constructor(private baseDir: string, private log: Logger, private limits = { cpuSeconds: 20, memoryMb: 512, fileMb: 50 }) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  dirFor(botId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(botId)) throw new Error('invalid bot id');
    return path.join(this.baseDir, botId);
  }

  async available() {
    return true;
  }

  async provision(botId: string) {
    const dir = this.dirFor(botId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.txt'), 'This is your sandbox home directory (demo mode).\n');
    this.log.info({ botId, dir }, 'demo sandbox provisioned');
    return { ref: dir };
  }

  async ensureRunning(botId: string) {
    fs.mkdirSync(this.dirFor(botId), { recursive: true });
  }

  exec(botId: string, command: string, { timeoutMs }: { timeoutMs: number }): Promise<ExecResult> {
    const dir = this.dirFor(botId);
    fs.mkdirSync(dir, { recursive: true });
    const { cpuSeconds, memoryMb, fileMb } = this.limits;
    const prelude =
      `ulimit -t ${cpuSeconds} 2>/dev/null; ulimit -v ${memoryMb * 1024} 2>/dev/null; ` +
      `ulimit -f ${fileMb * 2048} 2>/dev/null; cd "${dir}" || exit 1; `;
    return new Promise((resolve) => {
      const child = spawn('/bin/sh', ['-c', prelude + command], {
        cwd: dir,
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: dir, LANG: 'C.UTF-8', TERM: 'dumb' },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      let timedOut = false;
      child.stdout.on('data', (d: Buffer) => { if (out.length < 200_000) out += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { if (err.length < 200_000) err += d.toString(); });
      const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
      }, timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        const o = capOutput(out);
        const e = capOutput(err);
        resolve({ stdout: o.text, stderr: e.text, exitCode: code, timedOut, truncated: o.truncated || e.truncated });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: String(e), exitCode: null, timedOut, truncated: false });
      });
    });
  }

  async stop() { /* nothing long-running */ }

  async teardown(botId: string) {
    fs.rmSync(this.dirFor(botId), { recursive: true, force: true });
  }

  async status(botId: string): Promise<SandboxStatus> {
    return { kind: 'subprocess', state: fs.existsSync(this.dirFor(botId)) ? 'running' : 'missing', detail: 'demo mode (no isolation)' };
  }

  async listManaged() {
    return fs.readdirSync(this.baseDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  }
}
