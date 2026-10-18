import crypto from 'node:crypto';
import type { ContentBlock } from '../types.js';
import type { LlmClient, LlmRequest, LlmResponse } from './types.js';

/**
 * Deterministic stand-in for Claude, used when no ANTHROPIC_API_KEY is set (demo) and in tests.
 * Commands it understands:  "remember <fact>", "what do you remember", "forget <key>", "run <cmd>".
 */
export class MockLlmClient implements LlmClient {
  readonly name = 'mock';
  calls: LlmRequest[] = [];

  async stream(req: LlmRequest, onText: (d: string) => void): Promise<LlmResponse> {
    this.calls.push(req);
    const res = this.decide(req);
    for (const b of res.content) {
      if (b.type === 'text') for (const chunk of b.text.match(/.{1,12}/gs) ?? []) onText(chunk);
    }
    return res;
  }

  async complete(req: LlmRequest): Promise<string> {
    this.calls.push(req);
    const n = req.messages.length;
    return `Summary (mock) of ${n} earlier messages: ${JSON.stringify(req.messages.at(-1)?.content).slice(0, 120)}`;
  }

  private decide(req: LlmRequest): LlmResponse {
    const last = req.messages.at(-1);
    const tool = (name: string, input: Record<string, unknown>): LlmResponse => ({
      content: [
        { type: 'text', text: `Using ${name}… ` },
        { type: 'tool_use', id: `toolu_${crypto.randomBytes(6).toString('hex')}`, name, input },
      ],
      stopReason: 'tool_use',
    });
    const text = (t: string): LlmResponse => ({ content: [{ type: 'text', text: t }], stopReason: 'end_turn' });

    if (!last) return text('Hello!');
    const results = last.content.filter((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result');
    if (results.length) return text(`Done. Result: ${results.map((r) => r.content).join(' | ').slice(0, 400)}`);

    const userText = last.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ').trim();
    let m: RegExpMatchArray | null;
    if ((m = userText.match(/^remember(?: that)?\s+(.+)/i))) {
      const value = m[1]!;
      const key = value.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 3).join('_') || 'note';
      return tool('save_memory', { key, value });
    }
    if (/what do you (remember|know)/i.test(userText)) return tool('recall_memory', {});
    if ((m = userText.match(/^forget\s+(\S+)/i))) return tool('delete_memory', { key: m[1] });
    if ((m = userText.match(/^run[:\s]+(.+)/i))) return tool('run_shell', { command: m[1] });

    const memCount = (req.system.match(/^- \S+: /gm) ?? []).length;
    const ctxCount = req.messages.length;
    return text(
      `(demo model) You said: "${userText.slice(0, 200)}". I have ${ctxCount} message(s) in my context and ${memCount} memory item(s). ` +
        `Add ANTHROPIC_API_KEY to .env to use Claude.`,
    );
  }
}
