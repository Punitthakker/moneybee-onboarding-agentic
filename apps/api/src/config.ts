import { z } from 'zod';

const bool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? d : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  ANTHROPIC_MODEL_HEAVY: z.string().default('claude-opus-5-5'),
  /** auto: live when a key is present, otherwise mock. live: require key. mock: deterministic fixture parser. */
  LLM_MODE: z.enum(['auto', 'live', 'mock']).default('auto'),

  STORE: z.enum(['mongo', 'memory']).default('mongo'),
  REPO: z.enum(['mssql', 'memory']).default('mssql'),
  QUEUE_MODE: z.enum(['bullmq', 'inline']).default('bullmq'),

  MONGO_URL: z.string().default('mongodb://localhost:27017/moneybee_onboard'),
  MSSQL_URL: z.string().default('Server=localhost,1433;Database=moneybee_onboard;User Id=sa;Password=MoneyBee_Dev_123!;Encrypt=false;TrustServerCertificate=true'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  STORAGE: z.enum(['s3', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('moneybee-onboard'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),

  PII_ENC_KEY: z.string().default(''),
  PII_ENC_KEY_ID: z.string().default('k1'),
  FILE_ENC_KEY: z.string().optional(),
  JWT_SECRET: z.string().default(''),
  COOKIE_SECURE: bool(false),

  TOKEN_TTL_HOURS: z.coerce.number().positive().default(24),
  ONBOARDING_WEBHOOK_URL: z.string().optional(),
  ONBOARDING_WEBHOOK_SECRET: z.string().default(''),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  WEBHOOK_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
  FILE_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  CASE_TOKEN_BUDGET: z.coerce.number().int().positive().default(400000),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),

  SCREENING_PROVIDER: z.string().default('mock'),
  ADMIN_EMAIL: z.string().default('admin@moneybee.local'),
  ADMIN_PASSWORD: z.string().default(''),
  SEED_DEMO_DATA: bool(true),
  DEMO_PASSWORD: z.string().default(''),

  MAIL_HOST: z.string().optional(),
  MAIL_USER: z.string().optional(),
  MAIL_PASS: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = EnvSchema.parse(env);
  const prod = c.NODE_ENV === 'production';
  if (prod) {
    const missing = ['PII_ENC_KEY', 'JWT_SECRET', 'ADMIN_PASSWORD'].filter((k) => !(c as Record<string, unknown>)[k]);
    if (missing.length) throw new Error(`Missing required env in production: ${missing.join(', ')}`);
  }
  return c;
}

export function resolveLlmMode(c: Config): 'live' | 'mock' {
  if (c.LLM_MODE === 'live') {
    if (!c.ANTHROPIC_API_KEY) throw new Error('LLM_MODE=live requires ANTHROPIC_API_KEY');
    return 'live';
  }
  if (c.LLM_MODE === 'mock') return 'mock';
  return c.ANTHROPIC_API_KEY ? 'live' : 'mock';
}
