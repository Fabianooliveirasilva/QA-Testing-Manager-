import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import type { AppContext } from '../src/context.js';
import type { AiCompletion, AiCompletionRequest, AiProvider } from '../src/modules/ai/ai.provider.js';
import { MemoryMailer } from '../src/services/mailer.js';
import { LocalDiskStorage } from '../src/services/storage.js';

let prisma: PrismaClient | null = null;

export function testPrisma(): PrismaClient {
  prisma ??= new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  return prisma;
}

/** Test double for the AI provider: returns a scripted response and records prompts. */
export class FakeAiProvider implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly prompts: string[] = [];
  next: unknown = null;
  failWith: Error | null = null;

  async complete<T>(req: AiCompletionRequest<T>): Promise<AiCompletion<T>> {
    this.prompts.push(req.prompt);
    if (this.failWith) throw this.failWith;
    const parsed = req.schema.safeParse(this.next);
    if (!parsed.success) {
      const { AiProviderError } = await import('../src/modules/ai/ai.provider.js');
      throw new AiProviderError('invalid_output', 'The AI response did not match the expected format');
    }
    return { data: parsed.data, model: this.model, inputTokens: 10, outputTokens: 20 };
  }
}

export interface TestApp {
  app: Express;
  ctx: AppContext;
  mailer: MemoryMailer;
  ai: FakeAiProvider;
}

export function createTestApp(options: { withAi?: boolean } = {}): TestApp {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    WEB_ORIGIN: 'http://localhost:5173',
    APP_URL: 'http://localhost:5173',
    AI_DAILY_LIMIT_PER_USER: '3',
  });
  const mailer = new MemoryMailer();
  const ai = new FakeAiProvider();
  const ctx: AppContext = {
    config,
    prisma: testPrisma(),
    logger: pino({ level: 'silent' }),
    storage: new LocalDiskStorage(mkdtempSync(path.join(tmpdir(), 'qtm-storage-'))),
    mailer,
    ai: options.withAi === false ? null : ai,
  };
  return { app: createApp(ctx), ctx, mailer, ai };
}

/** Removes all rows; table names come from the Prisma schema (@@map). */
export async function resetDatabase(): Promise<void> {
  const db = testPrisma();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now()}.${++counter}@example.test`;
export const PASSWORD = 'Str0ngPassword!';

/** A logged-in client that sends the session cookie and CSRF header on every request. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  csrf = '';
  constructor(app: Express) {
    this.agent = request.agent(app);
  }
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: object) {
    const r = this.agent.post(url).set('x-csrf-token', this.csrf);
    return body ? r.send(body) : r;
  }
  patch(url: string, body: object) {
    return this.agent.patch(url).set('x-csrf-token', this.csrf).send(body);
  }
  delete(url: string) {
    return this.agent.delete(url).set('x-csrf-token', this.csrf);
  }
  async refreshCsrf() {
    const me = await this.agent.get('/api/auth/me');
    this.csrf = me.body.csrfToken;
    return me.body;
  }
}

export interface Account {
  client: Client;
  userId: string;
  email: string;
  orgId: string;
}

export async function registerAccount(app: Express, name = 'Tester', orgName = 'Acme QA'): Promise<Account> {
  const client = new Client(app);
  const email = uniqueEmail(name.toLowerCase().replace(/\W/g, ''));
  const res = await client.agent
    .post('/api/auth/register')
    .send({ name, email, password: PASSWORD, organizationName: orgName });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const me = await client.refreshCsrf();
  return { client, userId: me.user.id, email, orgId: me.organizations[0].id };
}

/** Registers a second user and adds them to `owner`'s organization with the given role. */
export async function addMember(app: Express, owner: Account, role: 'ADMIN' | 'MEMBER' | 'VIEWER'): Promise<Account> {
  const member = await registerAccount(app, `${role} user`, 'Personal');
  const res = await owner.client.post(`/api/organizations/${owner.orgId}/members`, { email: member.email, role });
  if (res.status !== 201) throw new Error(`add member failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...member, orgId: owner.orgId };
}

export async function createProject(account: Account, name = 'Web App') {
  const res = await account.client.post(`/api/organizations/${account.orgId}/projects`, { name, description: 'desc' });
  if (res.status !== 201) throw new Error(`create project failed: ${res.status} ${JSON.stringify(res.body)}`);
  const suites = await account.client.get(`/api/projects/${res.body.id}/suites`);
  return { projectId: res.body.id as string, suiteId: suites.body.items[0].id as string };
}
