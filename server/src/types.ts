export type BotStatus = 'provisioning' | 'ready' | 'stopped' | 'error';
export type SandboxKind = 'docker' | 'subprocess';

export interface Bot {
  id: string;
  name: string;
  persona: string;
  status: BotStatus;
  sandboxKind: SandboxKind | null;
  sandboxRef: string | null;
  voice: { enabled: boolean; name: string | null; rate: number };
  lastActiveAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Anthropic-compatible content block (subset we persist). */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  /** Opaque reasoning blocks from models with (adaptive) thinking; stored and replayed verbatim. */
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

export interface StoredMessage {
  id: number;
  botId: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  summarized: boolean;
  createdAt: number;
}

export interface Memory {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}
