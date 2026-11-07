import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiProviderError } from '../src/modules/ai/ai.provider.js';
import { addMember, createTestApp, registerAccount, resetDatabase, testPrisma, type Account } from './helpers.js';

// The external provider is replaced by a scripted double; these tests cover our own logic
// (opt-in, limits, validation, redaction, error mapping), not the vendor API.
const { app, ai } = createTestApp();
const unconfigured = createTestApp({ withAi: false });
let admin: Account;

const validCases = {
  testCases: [
    {
      title: 'Reject login with wrong password',
      category: 'NEGATIVE',
      priority: 'HIGH',
      type: 'FUNCTIONAL',
      preconditions: 'User exists',
      steps: [{ action: 'Submit wrong password', expectedResult: 'Error shown' }],
      expectedResult: 'User stays logged out',
    },
  ],
};

beforeAll(async () => {
  await resetDatabase();
  admin = await registerAccount(app);
});

beforeEach(() => {
  ai.failWith = null;
  ai.next = validCases;
});

describe('AI assistant', () => {
  const url = () => `/api/organizations/${admin.orgId}/ai/test-cases`;

  it('reports 503 when no provider is configured', async () => {
    const acc = await registerAccount(unconfigured.app);
    const status = await acc.client.get(`/api/organizations/${acc.orgId}/ai/status`);
    expect(status.body.configured).toBe(false);
    const res = await acc.client.post(`/api/organizations/${acc.orgId}/ai/test-cases`, { requirement: 'Login' });
    expect(res.status).toBe(503);
  });

  it('is disabled until an admin opts the organization in', async () => {
    const res = await admin.client.post(url(), { requirement: 'Users can log in' });
    expect(res.status).toBe(403);
    expect(ai.prompts).toHaveLength(0);
  });

  it('only admins can enable AI', async () => {
    const member = await addMember(app, admin, 'MEMBER');
    expect((await member.client.patch(`/api/organizations/${admin.orgId}`, { aiEnabled: true })).status).toBe(403);
    expect((await admin.client.patch(`/api/organizations/${admin.orgId}`, { aiEnabled: true })).status).toBe(200);
  });

  it('returns validated suggestions flagged as AI-generated and redacts secrets before sending', async () => {
    const res = await admin.client.post(url(), {
      requirement: 'Login for alice@corp.com. Staging password: Hunter2!! token sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV',
    });
    expect(res.status).toBe(200);
    expect(res.body.aiGenerated).toBe(true);
    expect(res.body.result.testCases[0].category).toBe('NEGATIVE');
    const sent = ai.prompts.at(-1)!;
    expect(sent).not.toContain('alice@corp.com');
    expect(sent).not.toContain('Hunter2!!');
    expect(sent).not.toContain('sk-ant-api03');
    expect(sent).toContain('<input>');
  });

  it('rejects malformed provider output with 502 instead of passing it through', async () => {
    ai.next = { testCases: [{ title: 'missing fields' }] };
    const res = await admin.client.post(url(), { requirement: 'x' });
    expect(res.status).toBe(502);
  });

  it('maps provider failures to explicit errors', async () => {
    ai.failWith = new AiProviderError('rate_limited', 'slow down');
    const res = await admin.client.post(`/api/organizations/${admin.orgId}/ai/bug-analysis`, { description: 'Crash' });
    expect(res.status).toBe(429);
  });

  it('enforces the per-user daily limit (3 in tests) and records usage', async () => {
    const res = await admin.client.post(url(), { requirement: 'x' });
    expect(res.status).toBe(429);
    expect(res.body.error.message).toMatch(/limit/);
    const rows = await testPrisma().aiRequest.findMany({ where: { userId: admin.userId } });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.success)).toHaveLength(1);
  });

  it('viewers cannot use the assistant', async () => {
    const viewer = await addMember(app, admin, 'VIEWER');
    expect((await viewer.client.post(url(), { requirement: 'x' })).status).toBe(403);
  });

  it('AI-generated test cases saved by a human keep the provenance flag', async () => {
    const projects = await admin.client.post(`/api/organizations/${admin.orgId}/projects`, { name: 'AI project' });
    const suites = await admin.client.get(`/api/projects/${projects.body.id}/suites`);
    const saved = await admin.client.post(`/api/projects/${projects.body.id}/test-cases`, {
      suiteId: suites.body.items[0].id,
      title: validCases.testCases[0]!.title,
      aiGenerated: true,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.aiGenerated).toBe(true);
    expect(saved.body.status).toBe('DRAFT');
  });
});
