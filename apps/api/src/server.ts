import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import type { AppContext } from './context.js';
import { createAiProvider } from './modules/ai/ai.routes.js';
import { LogMailer } from './services/mailer.js';
import { LocalDiskStorage } from './services/storage.js';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });
const prisma = new PrismaClient();

const ctx: AppContext = {
  config,
  prisma,
  logger,
  storage: new LocalDiskStorage(config.STORAGE_LOCAL_DIR),
  mailer: new LogMailer(logger, config.NODE_ENV !== 'production'),
  ai: createAiProvider(config),
};

const server = createApp(ctx).listen(config.API_PORT, () => {
  logger.info(
    { port: config.API_PORT, ai: ctx.ai ? `${ctx.ai.name}:${ctx.ai.model}` : 'not configured' },
    'QA Testing Manager API listening',
  );
});

// Periodically purge expired sessions and reset tokens.
const cleanup = setInterval(
  () => {
    const now = new Date();
    Promise.all([
      prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { absoluteExpiresAt: { lt: now } }] } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]).catch((err: unknown) => logger.error({ err }, 'session cleanup failed'));
  },
  60 * 60 * 1000,
);
cleanup.unref();

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
