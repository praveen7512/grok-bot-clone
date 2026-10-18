import { Router } from 'express';
import { z } from 'zod';
import { parseCookies } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE, type AuthService } from '../services/authService.js';

const loginSchema = z.object({ password: z.string().min(1).max(500) });

export function authRoutes(auth: AuthService, opts: { secureCookie: (reqSecure: boolean) => boolean }) {
  const r = Router();
  const attempts = new Map<string, { n: number; until: number }>();

  r.post('/login', (req, res) => {
    const ip = req.ip ?? 'unknown';
    const a = attempts.get(ip);
    if (a && a.until > Date.now()) throw new AppError(429, 'rate_limited', 'Too many attempts. Try again in a minute.');
    const { password } = loginSchema.parse(req.body);
    const token = auth.login(password);
    if (!token) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      throw new AppError(401, 'invalid_credentials', 'Wrong password');
    }
    attempts.delete(ip);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookie(req.secure),
      maxAge: auth.sessionTtlMs,
      path: '/',
    });
    res.json({ ok: true });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    const claims = auth.verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.json({ authenticated: !!claims, expiresAt: claims ? claims.exp * 1000 : null });
  });

  return r;
}
