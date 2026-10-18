import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeStack, say } from './helpers.js';

test('each bot has its own conversation history (no leakage)', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  const b = await s.bots.create({ name: 'Beta' });

  await say(s.chat, a.id, 'hello from A, secret code is 4242');
  await say(s.chat, a.id, 'second message for A');

  assert.equal(s.context.display(b.id).length, 0, 'Beta must not see Alpha messages');
  assert.ok(s.context.display(a.id).length >= 4);

  const { reply } = await say(s.chat, b.id, 'hi');
  assert.match(reply, /1 message\(s\) in my context/, 'Beta model call sees only its own single message');
  const lastCall = s.llm.calls.at(-1)!;
  assert.ok(!JSON.stringify(lastCall).includes('4242'), 'Alpha content never reaches Beta model call');
});

test('memories are namespaced per bot and injected only into that bot prompt', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  const b = await s.bots.create({ name: 'Beta' });
  await say(s.chat, a.id, 'remember favourite colour is teal');
  assert.equal(s.memory.list(a.id).length, 1);
  assert.equal(s.memory.list(b.id).length, 0);
  assert.match(s.chat.systemPrompt(s.bots.get(a.id)), /teal/);
  assert.doesNotMatch(s.chat.systemPrompt(s.bots.get(b.id)), /teal/);
  const recallB = await s.chat.executeTool(s.bots.get(b.id), 'recall_memory', { query: 'teal' });
  assert.equal(recallB.output, 'No matching memories.');
});

test('run_shell executes in the calling bot sandbox only', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  const b = await s.bots.create({ name: 'Beta' });
  await s.chat.executeTool(s.bots.get(a.id), 'run_shell', { command: 'echo only-a > a.txt' });
  assert.ok(fs.existsSync(path.join(s.subprocess.dirFor(a.id), 'a.txt')));
  const rb = await s.chat.executeTool(s.bots.get(b.id), 'run_shell', { command: 'ls' });
  assert.doesNotMatch(rb.output, /a\.txt/);
});

test('a bot handles one turn at a time', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  const p1 = s.chat.runTurn(a.id, 'first', () => undefined);
  await assert.rejects(s.chat.runTurn(a.id, 'second', () => undefined), /still answering/);
  await p1;
});

test('deleting a bot removes its context, memories and sandbox', async () => {
  const s = await makeStack();
  const a = await s.bots.create({ name: 'Alpha' });
  await say(s.chat, a.id, 'remember x is 1');
  await s.bots.delete(a.id);
  assert.equal(s.messages.listAll(a.id).length, 0);
  assert.equal(s.memory.list(a.id).length, 0);
  assert.equal(fs.existsSync(s.subprocess.dirFor(a.id)), false);
});
