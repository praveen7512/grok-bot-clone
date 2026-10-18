import { signToken, verifyToken } from '../lib/tokens.js';
import type { ScreenMode } from '../orchestrator/types.js';

export interface ScreenSession {
  token: string;
  mode: ScreenMode;
  expiresAt: number;
  wsPath: string;
}

/** Issues short-lived, bot-bound, mode-bound tokens for the VNC WebSocket. */
export class ScreenService {
  constructor(private opts: { secret: string; ttlSeconds: number }) {}

  issue(botId: string, mode: ScreenMode): ScreenSession {
    const token = signToken({ sub: 'owner', typ: 'screen', bot: botId, mode }, this.opts.secret, this.opts.ttlSeconds);
    return {
      token,
      mode,
      expiresAt: Date.now() + this.opts.ttlSeconds * 1000,
      wsPath: `/vnc/${botId}?token=${encodeURIComponent(token)}`,
    };
  }

  verify(token: string | null | undefined, botId: string): { mode: ScreenMode; exp: number } | null {
    const c = verifyToken(token, this.opts.secret, 'screen');
    if (!c || c.bot !== botId || (c.mode !== 'view' && c.mode !== 'control')) return null;
    return { mode: c.mode, exp: c.exp };
  }
}
