import type { ContentBlock } from '../types.js';

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
}

export interface LlmResponse {
  content: ContentBlock[];
  stopReason: string | null;
}

export interface LlmClient {
  readonly name: string;
  /** Streams text deltas via onText and resolves with the full assistant message. */
  stream(req: LlmRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<LlmResponse>;
  /** Single non-streaming completion returning plain text (used for summarisation). */
  complete(req: LlmRequest): Promise<string>;
}
