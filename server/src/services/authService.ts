import { safeEqual, signToken, verifyToken } from '../lib/tokens.js';

export const SESSION_COOKIE = 'botclone_session';

export class AuthService {
  constructor(private opts: { password: string; secret: string; sessionTtlHours: number }) {}

  login(password: string): string | null {
    if (!safeEqual(password, this.opts.password)) return null;
    return signToken({ sub: 'owner', typ: 'session' }, this.opts.secret, Math.round(this.opts.sessionTtlHours * 3600));
  }

  verifySession(token: string | undefined | null) {
    return verifyToken(token, this.opts.secret, 'session');
  }

  get sessionTtlMs() {
    return this.opts.sessionTtlHours * 3600 * 1000;
  }
}
