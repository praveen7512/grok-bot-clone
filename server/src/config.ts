import dotenv from 'dotenv';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repo root (works from server/src via tsx and from server/dist via node). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// .env in the repo root wins over one in the current directory; real env vars win over both
dotenv.config({ path: [path.join(repoRoot, '.env'), path.resolve('.env')], quiet: true });

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true' || v === 'yes');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.string().default('info'),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default('claude-sonnet-5-5'),
  CLAUDE_MAX_TOKENS: z.coerce.number().int().positive().default(8192),
  MOCK_LLM: bool,

  OWNER_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(24 * 7),
  SCREEN_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),

  SANDBOX_MODE: z.enum(['auto', 'docker', 'subprocess']).default('auto'),
  SANDBOX_IMAGE: z.string().default('botclone-sandbox:latest'),
  SANDBOX_MEMORY_MB: z.coerce.number().int().positive().default(512),
  SANDBOX_CPUS: z.coerce.number().positive().default(1),
  SANDBOX_PIDS_LIMIT: z.coerce.number().int().positive().default(256),
  SANDBOX_NETWORK: z.enum(['none', 'isolated', 'egress']).default('egress'),
  SANDBOX_IDLE_MINUTES: z.coerce.number().positive().default(30),
  SANDBOX_EXEC_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(60),
  DOCKER_SOCKET: z.string().optional(),

  CONTEXT_MAX_MESSAGES: z.coerce.number().int().min(10).default(40),
  CONTEXT_KEEP_MESSAGES: z.coerce.number().int().min(4).default(16),
  MEMORY_INJECT_LIMIT: z.coerce.number().int().positive().default(100),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(8),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid configuration:', parsed.error.issues);
  process.exit(1);
}
const env = parsed.data;

const generatedPassword = env.OWNER_PASSWORD ? undefined : crypto.randomBytes(9).toString('base64url');

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  dataDir: path.resolve(repoRoot, env.DATA_DIR),
  useMockLlm: env.MOCK_LLM || !env.ANTHROPIC_API_KEY,
  ownerPassword: env.OWNER_PASSWORD ?? generatedPassword!,
  ownerPasswordGenerated: !env.OWNER_PASSWORD,
  sessionSecret: env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex'),
  sessionSecretGenerated: !env.SESSION_SECRET,
};

export type AppConfig = typeof config;
