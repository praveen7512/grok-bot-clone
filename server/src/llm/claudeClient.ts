import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '../lib/errors.js';
import type { ContentBlock } from '../types.js';
import type { LlmClient, LlmRequest, LlmResponse } from './types.js';

export class ClaudeClient implements LlmClient {
  readonly name: string;
  private client: Anthropic;

  constructor(apiKey: string, private model: string, private defaultMaxTokens: number) {
    this.client = new Anthropic({ apiKey });
    this.name = `claude:${model}`;
  }

  private params(req: LlmRequest) {
    return {
      model: this.model,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
      system: req.system,
      messages: req.messages as Anthropic.MessageParam[],
      ...(req.tools?.length ? { tools: req.tools as Anthropic.Tool[] } : {}),
    };
  }

  private static toBlocks(content: Anthropic.ContentBlock[]): ContentBlock[] {
    const out: ContentBlock[] = [];
    for (const b of content) {
      if (b.type === 'text') out.push({ type: 'text', text: b.text });
      else if (b.type === 'tool_use') out.push({ type: 'tool_use', id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
      // thinking blocks must be sent back unchanged alongside tool_use blocks in the next request
      else if (b.type === 'thinking') out.push({ type: 'thinking', thinking: b.thinking, signature: b.signature });
      else if (b.type === 'redacted_thinking') out.push({ type: 'redacted_thinking', data: b.data });
    }
    return out;
  }

  /** Turns SDK errors into clear, user-facing messages. */
  static friendly(err: unknown): unknown {
    if (!(err instanceof Anthropic.APIError)) return err;
    const status = err.status ?? 0;
    if (status === 401) return new AppError(502, 'llm_auth', 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env and restart.');
    if (status === 403) return new AppError(502, 'llm_forbidden', 'This Anthropic key is not allowed to use the configured model (CLAUDE_MODEL).');
    if (status === 404) return new AppError(502, 'llm_model', 'Model not found. Check CLAUDE_MODEL in .env.');
    if (status === 429) return new AppError(503, 'llm_rate_limited', 'Anthropic rate limit reached. Wait a moment and try again.');
    if (status === 529 || status >= 500) return new AppError(503, 'llm_unavailable', 'Claude is temporarily overloaded/unavailable. Try again shortly.');
    return new AppError(502, 'llm_error', `Claude API error (${status}): ${err.message}`);
  }

  async stream(req: LlmRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<LlmResponse> {
    try {
      const stream = this.client.messages.stream(this.params(req), { signal });
      stream.on('text', (delta) => onText(delta));
      const msg = await stream.finalMessage();
      return { content: ClaudeClient.toBlocks(msg.content), stopReason: msg.stop_reason };
    } catch (err) {
      throw ClaudeClient.friendly(err);
    }
  }

  async complete(req: LlmRequest): Promise<string> {
    const msg = await this.client.messages.create({ ...this.params(req), stream: false }).catch((e) => { throw ClaudeClient.friendly(e); });
    return ClaudeClient.toBlocks(msg.content)
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
