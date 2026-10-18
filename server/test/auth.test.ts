import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../src/lib/tokens.js';
import { detectScreenIntent } from '../src/services/intent.js';
import { ScreenService } from '../src/services/screenService.js';
import { AuthService } from '../src/services/authService.js';

test('session login and token checks', () => {
  const auth = new AuthService({ password: 'pw', secret: 's', sessionTtlHours: 1 });
  assert.equal(auth.login('nope'), null);
  const t = auth.login('pw')!;
  assert.ok(auth.verifySession(t));
  assert.equal(auth.verifySession(t + 'x'), null, 'tampered');
  assert.equal(verifyToken(t, 's', 'screen'), null, 'wrong token type');
  assert.equal(verifyToken(signToken({ sub: 'o', typ: 'session' }, 's', -1), 's', 'session'), null, 'expired');
});

test('screen tokens are bound to a bot and mode', () => {
  const sc = new ScreenService({ secret: 's', ttlSeconds: 600 });
  const sess = sc.issue('bot-a', 'view');
  assert.equal(sc.verify(sess.token, 'bot-a')!.mode, 'view');
  assert.equal(sc.verify(sess.token, 'bot-b'), null);
  assert.match(sess.wsPath, /^\/vnc\/bot-a\?token=/);
});

test('screen intent detection (English + Hinglish)', () => {
  for (const t of ['show me your computer', 'Show me your screen please', 'apna computer dikhao', 'screen dikhao', 'apni screen dikha do', 'let me see your desktop'])
    assert.equal(detectScreenIntent(t), 'view', t);
  assert.equal(detectScreenIntent('show me your computer, I want to control it'), 'control');
  for (const t of ['how do I share my screen on zoom?', 'what is a computer', 'show me the code'])
    assert.equal(detectScreenIntent(t), null, t);
});
