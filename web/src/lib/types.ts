export type BotStatus = 'provisioning' | 'ready' | 'stopped' | 'error';

export interface VoiceSettings {
  enabled: boolean;
  name: string | null;
  rate: number;
}

export interface Bot {
  id: string;
  name: string;
  persona: string;
  status: BotStatus;
  sandboxKind: 'docker' | 'subprocess' | null;
  voice: VoiceSettings;
  lastActiveAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** client-only: optimistic placeholder while POST /bots is in flight */
  pending?: boolean;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  createdAt: number;
}

export interface Memory {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScreenSession {
  token: string;
  mode: 'view' | 'control';
  expiresAt: number;
  wsPath: string;
}

export type ChatEvent =
  | { type: 'user_saved'; message: StoredMessage }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'assistant_saved'; message: StoredMessage }
  | { type: 'screen'; session: ScreenSession }
  | { type: 'summarized' }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };

export interface Health {
  ok: boolean;
  llm: string;
  demoLlm: boolean;
  sandbox: { mode: string; defaultKind: 'docker' | 'subprocess'; dockerReachable: boolean };
}

export interface ToolItem {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
}

export interface Turn {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  tools: ToolItem[];
  createdAt: number;
  streaming?: boolean;
}
