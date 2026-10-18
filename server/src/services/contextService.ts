import type { Logger } from '../lib/logger.js';
import type { LlmClient, LlmMessage } from '../llm/types.js';
import type { MessageRepository } from '../repositories/messageRepository.js';
import type { ContentBlock, StoredMessage } from '../types.js';

const isToolResultMsg = (m: { content: ContentBlock[] }) => m.content.some((b) => b.type === 'tool_result');

/** Flattens blocks to readable text for summaries / display. */
export function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `[tool ${b.name} ${JSON.stringify(b.input)}]`;
      return `[tool result${b.is_error ? ' (error)' : ''}: ${b.content.slice(0, 500)}]`;
    })
    .join('\n');
}

/**
 * Makes a stored history safe to send to the API: merges consecutive same-role messages,
 * closes dangling tool_use blocks (e.g. after a crash mid-turn) and drops leading assistant turns.
 */
export function sanitizeHistory(msgs: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!;
    if (!out.length && m.role !== 'user') continue;
    if (!out.length && isToolResultMsg(m)) continue;
    const prev = out.at(-1);
    if (prev && prev.role === m.role) prev.content = [...prev.content, ...m.content];
    else out.push({ role: m.role, content: [...m.content] });
  }
  // ensure every tool_use has a tool_result right after it
  for (let i = 0; i < out.length; i++) {
    const m = out[i]!;
    if (m.role !== 'assistant') continue;
    const uses = m.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!uses.length) continue;
    let next = out[i + 1];
    if (!next || next.role !== 'user') {
      next = { role: 'user', content: [] };
      out.splice(i + 1, 0, next);
    }
    const have = new Set(next.content.filter((b) => b.type === 'tool_result').map((b) => (b as { tool_use_id: string }).tool_use_id));
    const missing = uses.filter((u) => !have.has(u.id)).map((u) => ({ type: 'tool_result' as const, tool_use_id: u.id, content: 'Interrupted before completion.', is_error: true }));
    next.content = [...next.content.filter((b) => b.type === 'tool_result'), ...missing, ...next.content.filter((b) => b.type !== 'tool_result')];
  }
  // tool_results not preceded by a matching tool_use are invalid: convert to text
  for (let i = 0; i < out.length; i++) {
    const m = out[i]!;
    if (m.role !== 'user') continue;
    const prevUses = new Set((out[i - 1]?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => (b as { id: string }).id));
    m.content = m.content.map((b) =>
      b.type === 'tool_result' && !prevUses.has(b.tool_use_id) ? { type: 'text', text: `[earlier tool result] ${b.content}` } : b,
    );
  }
  return out;
}

export class ContextService {
  constructor(
    private repo: MessageRepository,
    private log: Logger,
    private opts: { maxMessages: number; keepMessages: number },
  ) {}

  append(botId: string, role: 'user' | 'assistant', content: ContentBlock[]): StoredMessage {
    return this.repo.append(botId, role, content);
  }

  /** History for the model: only this bot, only unsummarised, sanitised. */
  history(botId: string): LlmMessage[] {
    return sanitizeHistory(this.repo.listActive(botId).map((m) => ({ role: m.role, content: m.content })));
  }

  summary(botId: string): string | null {
    return this.repo.getSummary(botId);
  }

  display(botId: string): StoredMessage[] {
    return this.repo.listAll(botId);
  }

  clear(botId: string) {
    this.repo.clear(botId);
  }

  /** Summarise the oldest part of the context when it grows beyond maxMessages. */
  async maybeSummarize(botId: string, llm: LlmClient): Promise<boolean> {
    const active = this.repo.listActive(botId);
    if (active.length <= this.opts.maxMessages) return false;
    let cut = active.length - this.opts.keepMessages;
    // cut must land on a plain user message so tool_use/tool_result pairs stay together
    while (cut < active.length && (active[cut]!.role !== 'user' || isToolResultMsg(active[cut]!))) cut++;
    if (cut <= 0 || cut >= active.length) return false;
    const old = active.slice(0, cut);
    const previous = this.repo.getSummary(botId);
    const transcript = old.map((m) => `${m.role.toUpperCase()}: ${blocksToText(m.content)}`).join('\n\n');
    const summary = await llm.complete({
      system:
        'You compress chat history for an AI assistant. Write a concise but complete summary (max ~300 words) ' +
        'preserving user facts, decisions, open tasks, and important tool outputs. Plain text.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `${previous ? `Existing summary:\n${previous}\n\n` : ''}New conversation to fold in:\n${transcript}` }],
        },
      ],
      maxTokens: 800,
    });
    this.repo.setSummary(botId, summary.trim());
    this.repo.markSummarized(botId, old.at(-1)!.id);
    this.log.info({ botId, folded: old.length }, 'context summarised');
    return true;
  }
}
