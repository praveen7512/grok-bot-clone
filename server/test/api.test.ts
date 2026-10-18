import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { makeStack, silentLog } from './helpers.js';

async function boot() {
  const s = await makeStack();
  const { server } = createApp({ ...s, log: silentLog, cookieSecure: 'false' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { s, server, base };
}

test('HTTP API: auth, lifecycle, chat stream, memory, validation', async () => {
  const { server, base } = await boot();
  try {
    assert.equal((await fetch(`${base}/api/bots`)).status, 401);
    assert.equal((await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"bad"}' })).status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"pw"}' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const h = { cookie, 'content-type': 'application/json' };

    const bad = await fetch(`${base}/api/bots`, { method: 'POST', headers: h, body: '{"name":""}' });
    assert.equal(bad.status, 400);

    const created = await fetch(`${base}/api/bots`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'Api Bot', voice: { enabled: true, rate: 1.2 } }) });
    assert.equal(created.status, 201);
    const { bot } = await created.json();
    assert.equal(bot.voice.rate, 1.2);

    const renamed = await (await fetch(`${base}/api/bots/${bot.id}`, { method: 'PATCH', headers: h, body: '{"name":"Renamed"}' })).json();
    assert.equal(renamed.bot.name, 'Renamed');

    const chat = await fetch(`${base}/api/bots/${bot.id}/chat`, { method: 'POST', headers: h, body: '{"message":"remember api works"}' });
    const body = await chat.text();
    assert.match(body, /"type":"tool_call"/);
    assert.match(body, /"type":"done"/);

    const mem = await (await fetch(`${base}/api/bots/${bot.id}/memories`, { headers: h })).json();
    assert.equal(mem.memories.length, 1);

    const screen = await fetch(`${base}/api/bots/${bot.id}/chat`, { method: 'POST', headers: h, body: '{"message":"apna computer dikhao"}' });
    assert.match(await screen.text(), /demo mode/);

    assert.equal((await fetch(`${base}/api/bots/${bot.id}`, { method: 'DELETE', headers: h })).status, 204);
    assert.equal((await fetch(`${base}/api/bots/${bot.id}`, { headers: h })).status, 404);
  } finally {
    server.close();
  }
});

test('VNC websocket rejects requests without owner session', async () => {
  const { s, server, base } = await boot();
  try {
    const bot = await s.bots.create({ name: 'V' });
    const token = s.screen.issue(bot.id, 'view').token;
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/vnc/${bot.id}?token=${token}`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => resolve(101));
      ws.on('error', () => undefined);
    });
    assert.equal(status, 401);
  } finally {
    server.close();
  }
});
