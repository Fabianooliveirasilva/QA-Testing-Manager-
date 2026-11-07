import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProject, createTestApp, registerAccount, resetDatabase, testPrisma, type Account } from './helpers.js';

const { app } = createTestApp();
let qa: Account;
let projectId: string;
let suiteId: string;

beforeAll(async () => {
  await resetDatabase();
  qa = await registerAccount(app);
  ({ projectId, suiteId } = await createProject(qa));
});

describe('injection and XSS', () => {
  const payloads = ["' OR '1'='1", "'; DROP TABLE users; --", '%', '_', '\\', '$where: 1'];

  it.each(payloads)('search treats %j as plain data', async (q) => {
    const res = await qa.client.get(`/api/projects/${projectId}/test-cases?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    const global = await qa.client.get(`/api/organizations/${qa.orgId}/search?q=${encodeURIComponent(q + 'xx')}`);
    expect(global.status).toBe(200);
  });

  it('database is intact after injection attempts', async () => {
    expect(await testPrisma().user.count()).toBeGreaterThan(0);
  });

  it('stores XSS payloads verbatim and only ever returns them as JSON', async () => {
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const res = await qa.client.post(`/api/projects/${projectId}/test-cases`, { suiteId, title: xss, description: xss });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const fetched = await qa.client.get(`/api/projects/${projectId}/test-cases/${res.body.id}`);
    expect(fetched.body.title).toBe(xss);
  });

  it('rejects unexpected types (parameter manipulation)', async () => {
    const res = await qa.client.post(`/api/projects/${projectId}/test-cases`, {
      suiteId,
      title: 'x',
      priority: 'ULTRA',
      tags: 'not-an-array',
    });
    expect(res.status).toBe(400);
  });

  it('ignores mass-assignment of server-controlled fields', async () => {
    const res = await qa.client.post(`/api/projects/${projectId}/bugs`, {
      title: 'Mass assignment',
      projectId: '00000000-0000-0000-0000-000000000000',
      createdById: '00000000-0000-0000-0000-000000000000',
      status: 'CLOSED',
    });
    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(projectId);
    expect(res.body.createdById).toBe(qa.userId);
    expect(res.body.status).toBe('OPEN');
  });
});

describe('transport and error hygiene', () => {
  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('CORS only allows the configured web origin', async () => {
    const allowed = await request(app).options('/api/auth/me').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app).options('/api/auth/me').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 400 for malformed JSON without leaking internals', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it('limits JSON payload size', async () => {
    const res = await qa.client.post(`/api/projects/${projectId}/bugs`, { title: 'x', description: 'a'.repeat(1_100_000) });
    expect(res.status).toBe(413);
  });

  it('unknown routes return a JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(401);
    const res2 = await request(app).get('/nope');
    expect(res2.status).toBe(404);
    expect(res2.body.error.code).toBe('NOT_FOUND');
  });

  it('never exposes password hashes or session tokens', async () => {
    const me = await qa.client.get('/api/auth/me');
    const members = await qa.client.get(`/api/organizations/${qa.orgId}/members`);
    for (const body of [me.body, members.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/passwordHash|password_hash|tokenHash|\$argon2/);
    }
  });
});
