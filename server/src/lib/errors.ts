import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Login required') => new AppError(401, 'unauthorized', msg);
export const conflict = (msg: string) => new AppError(409, 'conflict', msg);

export class SandboxUnavailableError extends AppError {
  constructor(message: string) {
    super(503, 'sandbox_unavailable', message);
  }
}

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'validation_error', message: 'Invalid request', details: err.issues } });
    return;
  }
  if (err instanceof AppError) {
    if (err.status >= 500) logger.warn({ err, path: req.path }, err.message);
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
}

export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: T, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
