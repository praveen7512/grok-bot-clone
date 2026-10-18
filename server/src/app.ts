import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { errorMiddleware, notFound } from './lib/errors.js';
import type { Logger } from './lib/logger.js';
import type { LlmClient } from './llm/types.js';
import type { Orchestrator } from './orchestrator/orchestrator.js';
import { authRoutes } from './routes/authRoutes.js';
import { botRoutes } from './routes/botRoutes.js';
import { requireOwner } from './routes/middleware.js';
import { attachVncProxy } from './routes/vncProxy.js';
import type { AuthService } from './services/authService.js';
import type { BotService } from './services/botService.js';
import type { ChatService } from './services/chatService.js';
import type { ContextService } from './services/contextService.js';
import type { MemoryService } from './services/memoryService.js';
import type { ScreenService } from './services/screenService.js';

export interface AppDeps {
  auth: AuthService;
  bots: BotService;
  chat: ChatService;
  context: ContextService;
  memory: MemoryService;
  screen: ScreenService;
  orchestrator: Orchestrator;
  llm: LlmClient;
  log: Logger;
  cookieSecure: 'auto' | 'true' | 'false';
  staticDir?: string;
  trustProxy?: boolean;
}

export function createApp(d: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  if (d.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) d.log.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, 'http');
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    res.json({ ok: true, llm: d.llm.name, demoLlm: d.llm.name === 'mock', sandbox: await d.orchestrator.health() });
  });

  const secureCookie = (reqSecure: boolean) => (d.cookieSecure === 'auto' ? reqSecure : d.cookieSecure === 'true');
  app.use('/api/auth', authRoutes(d.auth, { secureCookie }));
  app.use('/api/bots', requireOwner(d.auth), botRoutes(d));
  app.use('/api', (_req, _res, next) => next(notFound('Route')));

  if (d.staticDir && fs.existsSync(path.join(d.staticDir, 'index.html'))) {
    app.use(express.static(d.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|vnc\/).*/, (_req, res) => res.sendFile(path.join(d.staticDir!, 'index.html')));
  }

  app.use(errorMiddleware);

  const server = http.createServer(app);
  attachVncProxy(server, d);
  return { app, server };
}
