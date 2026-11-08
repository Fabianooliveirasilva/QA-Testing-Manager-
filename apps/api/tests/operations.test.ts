import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAdmin, generatePassword } from '../src/cli/create-admin.js';
import { passwordSchema } from '@qtm/shared';
import { EicarTestScanner, PASSWORD, createProject, createTestApp, registerAccount, resetDatabase, testPrisma, uniqueEmail } from './helpers.js';

beforeAll(resetDatabase);

describe('request correlation and health checks', () => {
  const { app, ctx } = createTestApp();

  it('generates an X-Request-Id and reuses a well-formed incoming one', async () => {
    const generated = await request(app).get('/api/health/live');
    expect(generated.status).toBe(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echoed = await request(app).get('/api/health/live').set('X-Request-Id', 'nginx-req-1234abcd');
    expect(echoed.headers['x-request-id']).toBe('nginx-req-1234abcd');
  });

  it('replaces malformed or oversized incoming ids (log injection)', async () => {
    const res = await request(app).get('/api/health/live').set('X-Request-Id', 'bad id <script>; injected=1');
    expect(res.headers['x-request-id']).not.toContain('bad');
    const long = await request(app).get('/api/health/live').set('X-Request-Id', 'a'.repeat(200));
    expect(long.headers['x-request-id']).toHaveLength(36);
  });

  it('readiness reports the database; liveness does not depend on it', async () => {
    const ready = await request(app).get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ok', checks: { database: 'ok' } });

    // A real client pointed at a closed port: readiness must fail closed with 503, liveness stays up.
    const unreachable = new PrismaClient({ datasourceUrl: 'postgresql://nobody:nothing@127.0.0.1:1/none' });
    const down = createApp({ ...ctx, prisma: unreachable, logger: pino({ level: 'silent' }) });
    const notReady = await request(down).get('/api/health/ready');
    expect(notReady.status).toBe(503);
    expect(notReady.body.checks.database).toBe('unavailable');
    expect(JSON.stringify(notReady.body)).not.toMatch(/nobody|127\.0\.0\.1|P1001/);
    expect((await request(down).get('/api/health/live')).status).toBe(200);
    await unreachable.$disconnect();
  });

  it('unexpected errors return a generic 500 with the request id and no internals', async () => {
    const unreachable = new PrismaClient({ datasourceUrl: 'postgresql://nobody:nothing@127.0.0.1:1/none' });
    const down = createApp({ ...ctx, prisma: unreachable, logger: pino({ level: 'silent' }) });
    const res = await request(down).post('/api/auth/login').send({ email: 'a@b.test', password: 'whatever-123A' });
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: res.headers['x-request-id'] });
    await unreachable.$disconnect();
  });
});

describe('self-registration switch', () => {
  it('blocks registration when REGISTRATION_ENABLED=false but login keeps working', async () => {
    const open = createTestApp();
    const account = await registerAccount(open.app);
    const closed = createTestApp({ env: { REGISTRATION_ENABLED: 'false' } });
    const res = await request(closed.app)
      .post('/api/auth/register')
      .send({ name: 'X', email: uniqueEmail('blocked'), password: PASSWORD, organizationName: 'X' });
    expect(res.status).toBe(403);
    expect((await request(closed.app).post('/api/auth/login').send({ email: account.email, password: PASSWORD })).status).toBe(200);
  });
});

describe('admin bootstrap CLI', () => {
  const prisma = testPrisma();
  afterAll(() => undefined);

  it('creates an owner that can sign in, and refuses to touch an existing user', async () => {
    const email = uniqueEmail('admin');
    const created = await createAdmin(prisma, { email, name: 'Admin', organizationName: 'Bootstrap Org', password: PASSWORD });
    const member = await prisma.organizationMember.findFirstOrThrow({ where: { userId: created.userId } });
    expect(member.role).toBe('OWNER');
    const { app } = createTestApp();
    expect((await request(app).post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
    await expect(createAdmin(prisma, { email, name: 'Other', organizationName: 'Other', password: PASSWORD })).rejects.toThrow(/already exists/);
  });

  it('rejects weak passwords and generates policy-compliant ones', async () => {
    await expect(createAdmin(prisma, { email: uniqueEmail('weak'), name: 'A', organizationName: 'A', password: 'short' })).rejects.toThrow();
    for (let i = 0; i < 20; i++) expect(passwordSchema.safeParse(generatePassword()).success).toBe(true);
  });
});

describe('malware scanner integration', () => {
  const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

  it('without a scanner, uploads are stored as NOT_SCANNED (never reported as clean)', async () => {
    const { app } = createTestApp();
    const acc = await registerAccount(app);
    const { projectId } = await createProject(acc);
    const bug = await acc.client.post(`/api/projects/${projectId}/bugs`, { title: 'b' });
    const res = await acc.client
      .post(`/api/projects/${projectId}/attachments`)
      .field('entityType', 'BUG')
      .field('entityId', bug.body.id)
      .attach('file', Buffer.from('log line'), { filename: 'a.log', contentType: 'text/plain' });
    expect(res.status).toBe(201);
    expect(res.body.scanStatus).toBe('NOT_SCANNED');
  });

  it('rejects files the configured scanner flags, stores nothing and audits the event', async () => {
    const { app } = createTestApp({ scanner: new EicarTestScanner() });
    const acc = await registerAccount(app);
    const { projectId } = await createProject(acc);
    const bug = await acc.client.post(`/api/projects/${projectId}/bugs`, { title: 'b' });
    const upload = (buf: Buffer) =>
      acc.client
        .post(`/api/projects/${projectId}/attachments`)
        .field('entityType', 'BUG')
        .field('entityId', bug.body.id)
        .attach('file', buf, { filename: 'notes.txt', contentType: 'text/plain' });
    const infected = await upload(EICAR);
    expect(infected.status).toBe(422);
    expect(infected.body.error.code).toBe('MALWARE_DETECTED');
    expect(await testPrisma().attachment.count({ where: { entityId: bug.body.id } })).toBe(0);
    const logs = await acc.client.get(`/api/organizations/${acc.orgId}/audit-logs`);
    expect(logs.body.items.some((l: { action: string }) => l.action === 'attachment.rejected_malware')).toBe(true);
    const clean = await upload(Buffer.from('ordinary notes'));
    expect(clean.status).toBe(201);
    expect(clean.body.scanStatus).toBe('CLEAN');
  });
});

describe('ClamAV adapter wiring (fail closed)', () => {
  it('scanner unreachable: upload rejected with 503, nothing stored, event audited; readiness reports it', async () => {
    const { ClamAvScanner } = await import('../src/services/clamav-scanner.js');
    const { app } = createTestApp({ scanner: new ClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 1_000 }) });
    const acc = await registerAccount(app);
    const { projectId } = await createProject(acc);
    const bug = await acc.client.post(`/api/projects/${projectId}/bugs`, { title: 'scan' });
    const res = await acc.client
      .post(`/api/projects/${projectId}/attachments`)
      .field('entityType', 'BUG')
      .field('entityId', bug.body.id)
      .attach('file', Buffer.from('notes'), { filename: 'n.txt', contentType: 'text/plain' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SCANNER_UNAVAILABLE');
    expect(await testPrisma().attachment.count({ where: { entityId: bug.body.id } })).toBe(0);
    const logs = await acc.client.get(`/api/organizations/${acc.orgId}/audit-logs`);
    expect(logs.body.items.some((l: { action: string }) => l.action === 'attachment.scan_failed')).toBe(true);

    const ready = await request(app).get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ database: 'ok', malwareScanner: 'unavailable' });
  });
});

describe('config: malware scanner', () => {
  it('requires CLAMAV_HOST when MALWARE_SCANNER=clamav', async () => {
    const { loadConfig } = await import('../src/config/env.js');
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', MALWARE_SCANNER: 'clamav' })).toThrow(/CLAMAV_HOST/);
  });
});
