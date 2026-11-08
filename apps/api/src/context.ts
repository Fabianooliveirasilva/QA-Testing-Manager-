import type { OrganizationMember, PrismaClient, Project, Session, User } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from './config/env.js';
import type { AiProvider } from './modules/ai/ai.provider.js';
import type { FileScanner } from './services/file-scanner.js';
import type { Mailer } from './services/mailer.js';
import type { StorageProvider } from './services/storage.js';

/** Dependencies injected into the app; tests replace mailer/AI provider with in-memory implementations. */
export interface AppContext {
  config: AppConfig;
  prisma: PrismaClient;
  logger: Logger;
  storage: StorageProvider;
  mailer: Mailer;
  ai: AiProvider | null;
  scanner: FileScanner;
}

export type SafeUser = Pick<User, 'id' | 'name' | 'email' | 'createdAt'>;

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id (validated X-Request-Id from the proxy, or generated). */
    requestId: string;
    user?: SafeUser;
    session?: Session;
    membership?: OrganizationMember;
    project?: Project;
  }
}
