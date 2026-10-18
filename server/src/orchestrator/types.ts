import type { Duplex } from 'node:stream';
import type { SandboxKind } from '../types.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export type SandboxState = 'running' | 'stopped' | 'missing' | 'unavailable';

export interface SandboxStatus {
  kind: SandboxKind;
  state: SandboxState;
  health?: string;
  detail?: string;
}

export type ScreenMode = 'view' | 'control';

export interface SandboxProvider {
  readonly kind: SandboxKind;
  readonly supportsScreen: boolean;
  available(): Promise<boolean>;
  /** Create (but do not necessarily start) the sandbox. Must be idempotent-safe to roll back with teardown(). */
  provision(botId: string): Promise<{ ref: string }>;
  /** Lazily (re)create and start the sandbox. */
  ensureRunning(botId: string): Promise<void>;
  exec(botId: string, command: string, opts: { timeoutMs: number }): Promise<ExecResult>;
  stop(botId: string): Promise<void>;
  teardown(botId: string): Promise<void>;
  status(botId: string): Promise<SandboxStatus>;
  /** Bot ids of all sandboxes this provider manages (for reconcile). */
  listManaged(): Promise<string[]>;
  /** Raw RFB byte stream to the sandbox's VNC server (control or view-only). */
  openVncStream?(botId: string, mode: ScreenMode): Promise<Duplex>;
}

export const MAX_OUTPUT = 16_000;

export function capOutput(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]`, truncated: true };
}
