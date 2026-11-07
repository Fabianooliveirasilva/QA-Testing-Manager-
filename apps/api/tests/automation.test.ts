import { readFileSync } from 'node:fs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createProject, createTestApp, registerAccount, resetDatabase, type Account } from './helpers.js';

const { app } = createTestApp();
// Genuine output of `playwright test --reporter=json` from examples/playwright-sample (paths normalized).
const REPORT = readFileSync(new URL('./fixtures/playwright-report.json', import.meta.url));

let qa: Account;
let projectId: string;
let suiteId: string;

beforeAll(async () => {
  await resetDatabase();
  qa = await registerAccount(app);
  ({ projectId, suiteId } = await createProject(qa));
  await qa.client.post(`/api/projects/${projectId}/test-cases`, { suiteId, title: 'Login OK', automationKey: 'LOGIN-001' });
  await qa.client.post(`/api/projects/${projectId}/test-cases`, { suiteId, title: 'Login KO', automationKey: 'LOGIN-002' });
});

const importReport = (body: Buffer, name = 'report.json') =>
  qa.client
    .post(`/api/projects/${projectId}/automation/playwright`)
    .field('runName', 'Nightly')
    .field('environment', 'ci')
    .attach('report', body, { filename: name, contentType: 'application/json' });

describe('Playwright JSON import (web upload)', () => {
  let runId: string;

  it('imports a real report with correct totals', async () => {
    const res = await importReport(REPORT);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'FAILED',
      totalTests: 5,
      passed: 3,
      failed: 1,
      skipped: 1,
      flaky: 1,
      matched: 2,
      executionSource: 'upload',
    });
    expect(res.body.reportMetadata.playwrightVersion).toBe('1.65.0');
    runId = res.body.testRunId;
  });

  it('stores results with errors, retries and links to managed test cases', async () => {
    const run = await qa.client.get(`/api/projects/${projectId}/test-runs/${runId}`);
    expect(run.body).toMatchObject({ source: 'PLAYWRIGHT', status: 'COMPLETED', name: 'Nightly', environment: 'ci' });
    const byTitle = (part: string) => run.body.results.find((r: { title: string }) => r.title.includes(part));
    const failing = byTitle('intentionally failing');
    expect(failing.status).toBe('FAILED');
    expect(failing.errorMessage).toContain('toHaveTitle');
    expect(failing.errorMessage.includes('\u001b')).toBe(false);
    expect(failing.retries).toBe(1);
    const flaky = byTitle('flaky');
    expect(flaky.status).toBe('PASSED');
    expect(flaky.metadata.flaky).toBe(true);
    expect(byTitle('remember-me').status).toBe('SKIPPED');
    const linked = byTitle('valid credentials show welcome');
    expect(linked.testCase.title).toBe('Login OK');
    expect(linked.title).toBe('[chromium] Login > valid credentials show welcome message');
  });

  it('automated results cannot be edited manually', async () => {
    const run = await qa.client.get(`/api/projects/${projectId}/test-runs/${runId}`);
    const res = await qa.client.patch(`/api/projects/${projectId}/test-runs/${runId}/results/${run.body.results[0].id}`, {
      status: 'PASSED',
    });
    expect(res.status).toBe(409);
  });

  it('rejects re-importing the same report (deduplication)', async () => {
    const res = await importReport(REPORT);
    expect(res.status).toBe(409);
    expect(res.body.error.details.testRunId).toBe(runId);
  });

  it('rejects invalid JSON, non-Playwright JSON and empty reports', async () => {
    expect((await importReport(Buffer.from('{not json'))).status).toBe(400);
    const wrong = await importReport(Buffer.from(JSON.stringify({ hello: 'world' })));
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('INVALID_REPORT');
    const empty = { suites: [], errors: [], stats: { startTime: new Date().toISOString(), duration: 1, expected: 0, unexpected: 0, flaky: 0, skipped: 0 } };
    expect((await importReport(Buffer.from(JSON.stringify(empty)))).status).toBe(400);
  });

  it('feeds dashboard metrics and the automation history', async () => {
    const list = await qa.client.get(`/api/projects/${projectId}/automation`);
    expect(list.body.total).toBe(1);
    const dash = await qa.client.get(`/api/organizations/${qa.orgId}/dashboard`);
    expect(dash.body.results).toMatchObject({ PASSED: 3, FAILED: 1, SKIPPED: 1 });
  });

  it('viewers cannot import', async () => {
    const viewer = await addMember(app, qa, 'VIEWER');
    const res = await viewer.client
      .post(`/api/projects/${projectId}/automation/playwright`)
      .attach('report', REPORT, { filename: 'r.json', contentType: 'application/json' });
    expect(res.status).toBe(403);
  });
});

describe('CI import with project API tokens', () => {
  it('creates a token (secret shown once), imports with it and can be revoked', async () => {
    const created = await qa.client.post(`/api/projects/${projectId}/tokens`, { name: 'GitHub Actions' });
    expect(created.status).toBe(201);
    const secret: string = created.body.token;
    expect(secret).toMatch(/^qtm_/);
    const list = await qa.client.get(`/api/projects/${projectId}/tokens`);
    expect(JSON.stringify(list.body)).not.toContain(secret);

    const report = JSON.parse(REPORT.toString());
    report.stats.startTime = new Date().toISOString();
    const res = await request(app)
      .post('/api/automation/playwright?runName=CI%20%2342')
      .set('Authorization', `Bearer ${secret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(report));
    expect(res.status).toBe(201);
    expect(res.body.executionSource).toMatch(/^api-token:qtm_/);

    expect((await qa.client.delete(`/api/projects/${projectId}/tokens/${created.body.id}`)).status).toBe(204);
    report.stats.startTime = new Date(Date.now() + 1000).toISOString();
    const revoked = await request(app)
      .post('/api/automation/playwright')
      .set('Authorization', `Bearer ${secret}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(report));
    expect(revoked.status).toBe(401);
  });

  it('rejects missing or forged tokens', async () => {
    expect((await request(app).post('/api/automation/playwright').send({})).status).toBe(401);
    const forged = await request(app)
      .post('/api/automation/playwright')
      .set('Authorization', 'Bearer qtm_forgedforgedforgedforgedforged')
      .set('Content-Type', 'application/json')
      .send(REPORT.toString());
    expect(forged.status).toBe(401);
  });

  it('members cannot create tokens', async () => {
    const member = await addMember(app, qa, 'MEMBER');
    expect((await member.client.post(`/api/projects/${projectId}/tokens`, { name: 'x' })).status).toBe(403);
  });
});
