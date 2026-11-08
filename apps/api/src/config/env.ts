import { parseSender } from '../services/mailer.js';
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
  EMAIL_PROVIDER: z.enum(['none', 'log', 'resend']).optional(),
  EMAIL_FROM: z.string().optional().default(''),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  MALWARE_SCANNER: z.enum(['none', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().optional().default(''),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  REGISTRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, 'EMAIL_PROVIDER'> & { EMAIL_PROVIDER: 'none' | 'log' | 'resend' };

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  // Default: log e-mails in development/test; send nothing in production unless a provider is chosen.
  const config: AppConfig = {
    ...parsed.data,
    EMAIL_PROVIDER: parsed.data.EMAIL_PROVIDER ?? (parsed.data.NODE_ENV === 'production' ? 'none' : 'log'),
  };
  if (config.MALWARE_SCANNER === 'clamav' && !config.CLAMAV_HOST) throw new Error('MALWARE_SCANNER=clamav requires CLAMAV_HOST');
  if (config.EMAIL_PROVIDER === 'resend') {
    if (!/^re_[A-Za-z0-9_-]{8,}$/.test(config.RESEND_API_KEY)) throw new Error('EMAIL_PROVIDER=resend requires a valid RESEND_API_KEY');
    try {
      parseSender(config.EMAIL_FROM);
    } catch (error) {
      throw new Error(`EMAIL_PROVIDER=resend: ${(error as Error).message}`);
    }
  }
  if (config.NODE_ENV === 'production') {
    if (!config.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (config.EMAIL_PROVIDER === 'log') throw new Error('EMAIL_PROVIDER=log would drop e-mails in production; use resend or none');
    // Defaults point at localhost; in production they would break CORS and password-reset links silently.
    const missing = ['APP_URL', 'WEB_ORIGIN'].filter((key) => !source[key]);
    if (missing.length) throw new Error(`${missing.join(', ')} must be set explicitly in production`);
  }
  return config;
}
