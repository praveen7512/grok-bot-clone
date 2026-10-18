import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { Orchestrator } from '../orchestrator/orchestrator.js';
import type { BotService } from '../services/botService.js';
import type { ChatEvent, ChatService } from '../services/chatService.js';
import type { ContextService } from '../services/contextService.js';
import type { MemoryService } from '../services/memoryService.js';
import type { ScreenService } from '../services/screenService.js';

const voiceSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().max(200).nullable().optional(),
    rate: z.number().min(0.5).max(2).optional(),
  })
  .strict();

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  persona: z.string().max(8000).optional(),
  voice: voiceSchema.optional(),
});
const updateSchema = z
  .object({ name: z.string().trim().min(1).max(60).optional(), persona: z.string().max(8000).optional(), voice: voiceSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const chatSchema = z.object({ message: z.string().trim().min(1).max(20_000) });
const memorySchema = z.object({ key: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(4000) });
const screenSchema = z.object({ mode: z.enum(['view', 'control']).default('view') });

const idParam = (req: Request) => {
  const id = String(req.params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Bot');
  return id;
};

export function botRoutes(d: {
  bots: BotService;
  chat: ChatService;
  context: ContextService;
  memory: MemoryService;
  screen: ScreenService;
  orchestrator: Orchestrator;
  log: Logger;
}) {
  const r = Router();

  // ---- lifecycle ----
  r.get('/', (_req, res) => {
    res.json({ bots: d.bots.list() });
  });

  r.post('/', asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const bot = await d.bots.create(input);
    res.status(201).json({ bot });
  }));

  r.get('/:id', (req, res) => {
    res.json({ bot: d.bots.get(idParam(req)) });
  });

  r.patch('/:id', (req, res) => {
    const bot = d.bots.update(idParam(req), updateSchema.parse(req.body));
    res.json({ bot });
  });

  r.delete('/:id', asyncHandler(async (req, res) => {
    await d.bots.delete(idParam(req));
    res.status(204).end();
  }));

  // ---- context ----
  r.get('/:id/messages', (req, res) => {
    const id = idParam(req);
    d.bots.get(id);
    res.json({ messages: d.context.display(id), summary: d.context.summary(id) });
  });

  r.delete('/:id/messages', (req, res) => {
    const id = idParam(req);
    d.bots.get(id);
    d.context.clear(id);
    res.status(204).end();
  });

  // ---- chat (SSE) ----
  r.post('/:id/chat', asyncHandler(async (req: Request, res: Response) => {
    const id = idParam(req);
    const { message } = chatSchema.parse(req.body);
    d.bots.get(id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const emit = (e: ChatEvent) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    const ping = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);
    try {
      await d.chat.runTurn(id, message, emit, ac.signal);
    } catch (err) {
      const e = err as { code?: string; message?: string; status?: number };
      d.log.warn({ err, botId: id }, 'chat turn failed');
      emit({ type: 'error', code: e.code ?? 'chat_failed', message: e.message ?? 'Chat failed' });
    } finally {
      clearInterval(ping);
      res.end();
    }
  }));

  // ---- memory ----
  r.get('/:id/memories', (req, res) => {
    const id = idParam(req);
    d.bots.get(id);
    res.json({ memories: d.memory.list(id) });
  });

  r.put('/:id/memories', (req, res) => {
    const id = idParam(req);
    d.bots.get(id);
    const { key, value } = memorySchema.parse(req.body);
    res.json({ memory: d.memory.save(id, key, value) });
  });

  r.delete('/:id/memories/:key', (req, res) => {
    const id = idParam(req);
    d.bots.get(id);
    if (!d.memory.delete(id, String(req.params.key))) throw notFound('Memory');
    res.status(204).end();
  });

  // ---- sandbox ----
  r.get('/:id/sandbox', asyncHandler(async (req, res) => {
    const bot = d.bots.get(idParam(req));
    res.json({ sandbox: await d.orchestrator.status(bot.id, bot.sandboxKind) });
  }));

  r.post('/:id/sandbox/start', asyncHandler(async (req, res) => {
    const bot = d.bots.get(idParam(req));
    await d.orchestrator.ensureRunning(bot.id, bot.sandboxKind);
    d.bots.setStatus(bot.id, 'ready');
    res.json({ sandbox: await d.orchestrator.status(bot.id, bot.sandboxKind) });
  }));

  // ---- screen ----
  r.post('/:id/screen-session', asyncHandler(async (req, res) => {
    const bot = d.bots.get(idParam(req));
    const { mode } = screenSchema.parse(req.body ?? {});
    if (!d.orchestrator.provider(bot.sandboxKind).supportsScreen) {
      res.status(501).json({ error: { code: 'screen_unsupported', message: 'Screen sharing needs Docker sandboxes (not available in demo mode).' } });
      return;
    }
    await d.orchestrator.ensureRunning(bot.id, bot.sandboxKind);
    res.json({ session: d.screen.issue(bot.id, mode) });
  }));

  return r;
}
