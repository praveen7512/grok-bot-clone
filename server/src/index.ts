import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { logger } from './lib/logger.js';
import { ClaudeClient } from './llm/claudeClient.js';
import { MockLlmClient } from './llm/mockClient.js';
import type { LlmClient } from './llm/types.js';
import { DockerProvider } from './orchestrator/dockerProvider.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { SubprocessProvider } from './orchestrator/subprocessProvider.js';
import { BotRepository } from './repositories/botRepository.js';
import { MemoryRepository } from './repositories/memoryRepository.js';
import { MessageRepository } from './repositories/messageRepository.js';
import { AuthService } from './services/authService.js';
import { BotService } from './services/botService.js';
import { ChatService } from './services/chatService.js';
import { ContextService } from './services/contextService.js';
import { MemoryService } from './services/memoryService.js';
import { ScreenService } from './services/screenService.js';
import { createApp } from './app.js';

async function main() {
  const log = logger;
  const db = openDb(path.join(config.dataDir, 'botclone.db'));

  const llm: LlmClient = config.useMockLlm
    ? new MockLlmClient()
    : new ClaudeClient(config.ANTHROPIC_API_KEY!, config.CLAUDE_MODEL, config.CLAUDE_MAX_TOKENS);
  if (config.useMockLlm) log.warn('No ANTHROPIC_API_KEY (or MOCK_LLM=1): using the built-in DEMO model. Put your key in .env to use Claude.');

  const docker =
    config.SANDBOX_MODE === 'subprocess'
      ? undefined
      : new DockerProvider(
          {
            image: config.SANDBOX_IMAGE,
            memoryMb: config.SANDBOX_MEMORY_MB,
            cpus: config.SANDBOX_CPUS,
            pidsLimit: config.SANDBOX_PIDS_LIMIT,
            network: config.SANDBOX_NETWORK,
            instance: 'botclone',
            socketPath: config.DOCKER_SOCKET,
          },
          log,
        );
  const subprocess = new SubprocessProvider(path.join(config.dataDir, 'sandboxes'), log);
  const orchestrator = new Orchestrator(
    { docker, subprocess },
    { mode: config.SANDBOX_MODE, idleMinutes: config.SANDBOX_IDLE_MINUTES, execTimeoutMs: config.SANDBOX_EXEC_TIMEOUT_SECONDS * 1000 },
    log,
  );
  await orchestrator.init();

  const botRepo = new BotRepository(db);
  const bots = new BotService(botRepo, orchestrator, log);
  const context = new ContextService(new MessageRepository(db), log, {
    maxMessages: config.CONTEXT_MAX_MESSAGES,
    keepMessages: config.CONTEXT_KEEP_MESSAGES,
  });
  const memory = new MemoryService(new MemoryRepository(db), config.MEMORY_INJECT_LIMIT);
  const screen = new ScreenService({ secret: config.sessionSecret, ttlSeconds: config.SCREEN_TOKEN_TTL_SECONDS });
  const auth = new AuthService({ password: config.ownerPassword, secret: config.sessionSecret, sessionTtlHours: config.SESSION_TTL_HOURS });
  const chat = new ChatService({ bots, context, memory, orchestrator, screen, llm, log, maxSteps: config.AGENT_MAX_STEPS });

  await bots.recoverOnStartup().catch((err) => log.error({ err }, 'startup reconcile failed'));
  orchestrator.startBackgroundTasks();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.resolve(here, '../../web/dist');
  const { server } = createApp({
    auth, bots, chat, context, memory, screen, orchestrator, llm, log,
    cookieSecure: config.COOKIE_SECURE,
    staticDir,
    trustProxy: config.isProd,
  });

  server.listen(config.PORT, config.HOST, () => {
    log.info({ url: `http://localhost:${config.PORT}`, llm: llm.name }, 'BotClone server listening');
    if (config.ownerPasswordGenerated) {
      log.warn(`OWNER_PASSWORD not set. One-time password for this run: ${config.ownerPassword}  (set OWNER_PASSWORD in .env)`);
    }
    if (config.sessionSecretGenerated) log.warn('SESSION_SECRET not set: sessions reset on every restart.');
  });

  const shutdown = (sig: string) => {
    log.info({ sig }, 'shutting down');
    orchestrator.shutdown();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
