import { z } from 'zod';

const boolean = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  APP_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().positive().default(7),
  COOKIE_SECURE: boolean,
  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  AI_PROVIDER: z.enum(['anthropic', 'none']).default('none'),
  AI_MODEL: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  AI_DAILY_LIMIT_PER_USER: z.coerce.number().int().min(0).default(50),
  AI_DAILY_LIMIT_PER_ORG: z.coerce.number().int().min(0).default(500),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: boolean,
  REGISTRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    if (!config.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    // Defaults point at localhost; in production they would break CORS and password-reset links silently.
    const missing = ['APP_URL', 'WEB_ORIGIN'].filter((key) => !source[key]);
    if (missing.length) throw new Error(`${missing.join(', ')} must be set explicitly in production`);
  }
  return config;
}
