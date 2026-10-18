import type { Logger } from '../lib/logger.js';
import { AppError, conflict } from '../lib/errors.js';
import type { LlmClient, ToolDef } from '../llm/types.js';
import type { Orchestrator } from '../orchestrator/orchestrator.js';
import type { Bot, ContentBlock, StoredMessage } from '../types.js';
import type { BotService } from './botService.js';
import type { ContextService } from './contextService.js';
import { detectScreenIntent } from './intent.js';
import type { MemoryService } from './memoryService.js';
import type { ScreenService, ScreenSession } from './screenService.js';

export type ChatEvent =
  | { type: 'user_saved'; message: StoredMessage }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'assistant_saved'; message: StoredMessage }
  | { type: 'screen'; session: ScreenSession }
  | { type: 'summarized' }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string };

export const TOOLS: ToolDef[] = [
  {
    name: 'save_memory',
    description:
      'Save a durable fact to YOUR long-term memory (persists across sessions). Use for user preferences, ' +
      'personal details, ongoing projects, decisions. Re-using a key overwrites it.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short snake_case key, e.g. "user_name" or "favourite_language"' },
        value: { type: 'string', description: 'The fact to remember' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'recall_memory',
    description: 'Search your long-term memory. Omit query to list recent memories.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'delete_memory',
    description: 'Delete a memory by key when it is wrong or the user asks you to forget it.',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'run_shell',
    description:
      'Run a bash command on YOUR own private Linux sandbox computer (home: /home/bot). ' +
      'Files persist between calls. Returns stdout, stderr and exit code. Non-interactive commands only.',
    input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
];

export class ChatService {
  private busy = new Set<string>();

  constructor(
    private deps: {
      bots: BotService;
      context: ContextService;
      memory: MemoryService;
      orchestrator: Orchestrator;
      screen: ScreenService;
      llm: LlmClient;
      log: Logger;
      maxSteps: number;
    },
  ) {}

  systemPrompt(bot: Bot): string {
    const { memory, context } = this.deps;
    const summary = context.summary(bot.id);
    const sandboxNote =
      bot.sandboxKind === 'subprocess'
        ? 'Your computer is running in DEMO mode (a restricted working directory, not a full Linux box; no desktop).'
        : 'Your computer is a Debian Linux container with a virtual desktop (DISPLAY=:1). The owner can watch it via screen share.';
    return [
      `You are "${bot.name}", a personal AI assistant bot. You are one of several independent bots; you only know your own conversations and memories.`,
      bot.persona ? `Persona / instructions from your owner:\n${bot.persona}` : '',
      `You have your own computer. Use the run_shell tool to run commands on it when it helps. ${sandboxNote}`,
      'Long-term memory: when you learn something durable about the user or their work, call save_memory. Use recall_memory to look things up. Your current memories are listed below; trust them.',
      'Be concise and helpful. Reply in the language the user writes in (Hinglish is fine).',
      summary ? `## Summary of earlier conversation\n${summary}` : '',
      `## Your memories\n${memory.promptBlock(bot.id)}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** Executes a tool call. botId comes from the route, never from model input. */
  async executeTool(bot: Bot, name: string, input: Record<string, unknown>): Promise<{ output: string; isError: boolean }> {
    const { memory, orchestrator } = this.deps;
    try {
      switch (name) {
        case 'save_memory': {
          const m = memory.save(bot.id, String(input.key ?? ''), String(input.value ?? ''));
          return { output: `Saved memory "${m.key}".`, isError: false };
        }
        case 'recall_memory': {
          const items = memory.recall(bot.id, input.query ? String(input.query) : undefined);
          return { output: items.length ? items.map((m) => `${m.key}: ${m.value}`).join('\n') : 'No matching memories.', isError: false };
        }
        case 'delete_memory': {
          const ok = memory.delete(bot.id, String(input.key ?? ''));
          return { output: ok ? 'Deleted.' : 'No memory with that key.', isError: !ok };
        }
        case 'run_shell': {
          const cmd = String(input.command ?? '').trim();
          if (!cmd) return { output: 'Empty command.', isError: true };
          const r = await orchestrator.exec(bot.id, bot.sandboxKind, cmd);
          if (bot.status !== 'ready') this.deps.bots.setStatus(bot.id, 'ready'); // sandbox was lazily re-created
          const parts = [
            `exit_code: ${r.exitCode ?? 'unknown'}${r.timedOut ? ' (timed out)' : ''}`,
            r.stdout ? `stdout:\n${r.stdout}` : 'stdout: (empty)',
            r.stderr ? `stderr:\n${r.stderr}` : '',
          ].filter(Boolean);
          return { output: parts.join('\n'), isError: r.exitCode !== 0 };
        }
        default:
          return { output: `Unknown tool: ${name}`, isError: true };
      }
    } catch (err) {
      const msg = err instanceof AppError ? err.message : `Tool failed: ${(err as Error).message}`;
      return { output: msg, isError: true };
    }
  }

  async runTurn(botId: string, userText: string, emit: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const { bots, context, llm, log, screen, orchestrator } = this.deps;
    const bot = bots.get(botId);
    if (this.busy.has(botId)) throw conflict('This bot is still answering the previous message.');
    this.busy.add(botId);
    try {
      // auto-save: the user's message is persisted before anything else happens
      emit({ type: 'user_saved', message: context.append(botId, 'user', [{ type: 'text', text: userText }]) });
      bots.touch(botId);
      orchestrator.touch(botId);

      const screenMode = detectScreenIntent(userText);
      if (screenMode) {
        const supports = orchestrator.provider(bot.sandboxKind).supportsScreen;
        let reply: string;
        if (supports) {
          emit({ type: 'screen', session: screen.issue(botId, screenMode) });
          reply =
            screenMode === 'control'
              ? 'Opening my desktop with remote control. You can use the mouse and keyboard in the screen panel.'
              : 'Opening my desktop in view-only mode. Switch to "Control" in the screen panel if you want to take over.';
        } else {
          reply = 'My computer is running in demo mode right now, so there is no desktop to share. Run BotClone with Docker to enable screen sharing.';
        }
        emit({ type: 'text', delta: reply });
        emit({ type: 'assistant_saved', message: context.append(botId, 'assistant', [{ type: 'text', text: reply }]) });
        emit({ type: 'done' });
        return;
      }

      for (let step = 0; step < this.deps.maxSteps; step++) {
        if (signal?.aborted) break;
        const current = bots.get(botId); // persona/memories may have changed
        const res = await llm.stream(
          { system: this.systemPrompt(current), messages: context.history(botId), tools: TOOLS },
          (delta) => emit({ type: 'text', delta }),
          signal,
        );
        const content: ContentBlock[] = res.content.length ? res.content : [{ type: 'text', text: '' }];
        emit({ type: 'assistant_saved', message: context.append(botId, 'assistant', content) });

        const uses = content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
        if (!uses.length) break;
        const results: ContentBlock[] = [];
        for (const u of uses) {
          emit({ type: 'tool_call', id: u.id, name: u.name, input: u.input });
          const r = await this.executeTool(current, u.name, u.input);
          log.info({ botId, tool: u.name, isError: r.isError }, 'tool executed');
          emit({ type: 'tool_result', id: u.id, name: u.name, output: r.output, isError: r.isError });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: r.output, ...(r.isError ? { is_error: true } : {}) });
        }
        context.append(botId, 'user', results);
        if (step === this.deps.maxSteps - 1) {
          const note = '\n\n(Stopped after the maximum number of tool steps.)';
          emit({ type: 'text', delta: note });
          context.append(botId, 'assistant', [{ type: 'text', text: note.trim() }]);
        }
      }

      try {
        if (await context.maybeSummarize(botId, llm)) emit({ type: 'summarized' });
      } catch (err) {
        log.warn({ err, botId }, 'summarisation failed (history kept intact)');
      }
      emit({ type: 'done' });
    } finally {
      this.busy.delete(botId);
    }
  }
}
