import Anthropic from '@anthropic-ai/sdk';
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
    }
    return out;
  }

  async stream(req: LlmRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<LlmResponse> {
    const stream = this.client.messages.stream(this.params(req), { signal });
    stream.on('text', (delta) => onText(delta));
    const msg = await stream.finalMessage();
    return { content: ClaudeClient.toBlocks(msg.content), stopReason: msg.stop_reason };
  }

  async complete(req: LlmRequest): Promise<string> {
    const msg = await this.client.messages.create({ ...this.params(req), stream: false });
    return ClaudeClient.toBlocks(msg.content)
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
}
