import pino from 'pino';

const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'botclone' },
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.apiKey', '*.password', '*.token'],
  ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } } : {}),
});

export type Logger = typeof logger;
