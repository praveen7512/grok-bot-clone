import type { NextFunction, Request, Response } from 'express';
import { parseCookies } from '../lib/tokens.js';
import { unauthorized } from '../lib/errors.js';
import { SESSION_COOKIE, type AuthService } from '../services/authService.js';

export const requireOwner = (auth: AuthService) => (req: Request, _res: Response, next: NextFunction) => {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!auth.verifySession(token)) return next(unauthorized('Session expired or missing. Please log in.'));
  next();
};
