import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHistory } from '../src/services/contextService.js';
import { makeStack, say } from './helpers.js';

test('user message is auto-saved even if the model call fails', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  s.llm.stream = async () => { throw new Error('network down'); };
  await assert.rejects(s.chat.runTurn(a.id, 'are you there?', () => undefined), /network down/);
  const saved = s.context.display(a.id);
  assert.equal(saved.length, 1);
  assert.equal((saved[0]!.content[0] as { text: string }).text, 'are you there?');
});

test('long histories are summarised at a safe boundary', async () => {
  const s = await makeStack({ maxMessages: 10, keepMessages: 4 });
  const a = await s.bots.create({ name: 'Alpha' });
  for (let i = 0; i < 4; i++) await say(s.chat, a.id, `remember fact number ${i}`); // 4 msgs each (user, tool_use, tool_result, text)
  const active = s.messages.listActive(a.id);
  assert.ok(active.length <= 10, `active=${active.length}`);
  assert.ok(s.context.summary(a.id), 'summary stored');
  assert.equal(active[0]!.role, 'user');
  assert.ok(active[0]!.content.every((b) => b.type === 'text'), 'kept history starts with a plain user message');
  assert.equal(s.context.display(a.id).length, 16, 'UI still has full history');
  assert.match(s.chat.systemPrompt(s.bots.get(a.id)), /Summary of earlier conversation/);
});

test('sanitizeHistory closes dangling tool_use and merges roles', () => {
  const out = sanitizeHistory([
    { role: 'assistant', content: [{ type: 'text', text: 'orphan' }] },
    { role: 'user', content: [{ type: 'text', text: 'a' }] },
    { role: 'user', content: [{ type: 'text', text: 'b' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'run_shell', input: {} }] },
  ]);
  assert.equal(out[0]!.role, 'user');
  assert.equal(out[0]!.content.length, 2);
  assert.equal(out.at(-1)!.role, 'user');
  assert.equal((out.at(-1)!.content[0] as { tool_use_id: string }).tool_use_id, 't1');
});
