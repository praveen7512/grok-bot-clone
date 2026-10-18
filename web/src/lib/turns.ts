import type { StoredMessage, Turn } from './types';

/** Collapses stored Anthropic messages into display turns (assistant steps + tool calls merged). */
export function toTurns(messages: StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  const toolIndex = new Map<string, { turn: Turn; i: number }>();
  for (const m of messages) {
    const results = m.content.filter((b) => b.type === 'tool_result');
    if (m.role === 'user' && results.length) {
      for (const r of results) {
        if (r.type !== 'tool_result') continue;
        const ref = toolIndex.get(r.tool_use_id);
        if (ref) ref.turn.tools[ref.i] = { ...ref.turn.tools[ref.i]!, output: r.content, isError: !!r.is_error };
      }
      continue;
    }
    const text = m.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    if (m.role === 'user') {
      turns.push({ key: `m${m.id}`, role: 'user', text, tools: [], createdAt: m.createdAt });
      continue;
    }
    let turn = turns.at(-1);
    if (!turn || turn.role !== 'assistant') {
      turn = { key: `m${m.id}`, role: 'assistant', text: '', tools: [], createdAt: m.createdAt };
      turns.push(turn);
    }
    if (text) turn.text = turn.text ? `${turn.text}\n\n${text}` : text;
    for (const b of m.content) {
      if (b.type === 'tool_use') {
        turn.tools.push({ id: b.id, name: b.name, input: b.input });
        toolIndex.set(b.id, { turn, i: turn.tools.length - 1 });
      }
    }
  }
  return turns;
}

export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]+/g, '')
    .replace(/\n{2,}/g, '. ')
    .trim();
}
