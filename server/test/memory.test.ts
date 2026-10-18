import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeStack, say, tmpDir } from './helpers.js';

test('save / upsert / recall / delete', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  s.memory.save(a.id, 'User Name', 'Praveen');
  s.memory.save(a.id, 'user_name', 'Praveen Sahu');
  assert.equal(s.memory.list(a.id).length, 1, 'same key overwrites');
  assert.equal(s.memory.recall(a.id, 'sahu')[0]!.value, 'Praveen Sahu');
  assert.equal(s.memory.recall(a.id, '%').length, 0, 'LIKE wildcards are escaped');
  assert.ok(s.memory.delete(a.id, 'user_name'));
  assert.equal(s.memory.list(a.id).length, 0);
});

test('memory tools are wired through the agent loop', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  const r1 = await say(s.chat, a.id, 'remember my editor is neovim');
  assert.ok(r1.events.some((e) => e.type === 'tool_call' && e.name === 'save_memory'));
  const r2 = await say(s.chat, a.id, 'what do you remember?');
  assert.match(r2.reply, /neovim/);
  const sys = s.llm.calls.at(-1)!.system;
  assert.match(sys, /## Your memories\n- my_editor_is: my editor is neovim/);
});

test('memory and context persist across restarts', async () => {
  const dbFile = path.join(tmpDir(), 'persist.db');
  const s1 = await makeStack({ dbFile });
  const a = await s1.bots.create({ name: 'Alpha' });
  await say(s1.chat, a.id, 'remember timezone is IST');
  s1.db.close();

  const s2 = await makeStack({ dbFile });
  assert.equal(s2.bots.get(a.id).name, 'Alpha');
  assert.equal(s2.memory.list(a.id)[0]!.value, 'timezone is IST');
  assert.ok(s2.context.display(a.id).length >= 3);
  assert.match(s2.chat.systemPrompt(s2.bots.get(a.id)), /timezone is IST/);
});
