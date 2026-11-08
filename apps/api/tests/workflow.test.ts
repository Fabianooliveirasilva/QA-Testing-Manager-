import { beforeAll, describe, expect, it } from 'vitest';
import { createProject, createTestApp, registerAccount, resetDatabase, testPrisma, type Account } from './helpers.js';

const { app } = createTestApp();
let qa: Account;
let projectId: string;
let suiteId: string;
const base = () => `/api/projects/${projectId}`;

beforeAll(async () => {
  await resetDatabase();
  qa = await registerAccount(app, 'QA Lead', 'Quality Co');
  ({ projectId, suiteId } = await createProject(qa, 'Checkout'));
});

describe('projects', () => {
  it('lists, updates and reports counts', async () => {
    const list = await qa.client.get(`/api/organizations/${qa.orgId}/projects`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const upd = await qa.client.patch(base(), { description: 'Checkout flows', leadId: qa.userId });
    expect(upd.status).toBe(200);
    expect(upd.body.leadId).toBe(qa.userId);
  });

  it('manages project members', async () => {
    const members = await qa.client.get(`${base()}/members`);
    expect(members.body.items).toHaveLength(1);
    const dup = await qa.client.post(`${base()}/members`, { userId: qa.userId });
    expect(dup.status).toBe(409);
  });
});

describe('suites and test cases', () => {
  let caseId: string;

  it('creates a suite and rejects duplicate names', async () => {
    const res = await qa.client.post(`${base()}/suites`, { name: 'Payments' });
    expect(res.status).toBe(201);
    expect((await qa.client.post(`${base()}/suites`, { name: 'Payments' })).status).toBe(409);
  });

  it('creates a test case with ordered steps and normalized tags', async () => {
    const res = await qa.client.post(`${base()}/test-cases`, {
      suiteId,
      title: 'Pay with valid card',
      preconditions: 'Cart has 1 item',
      priority: 'HIGH',
      type: 'E2E',
      environment: 'staging',
      tags: ['Payments', 'smoke', 'smoke'],
      expectedResult: 'Order confirmed',
      automationKey: 'PAY-001',
      steps: [
        { action: 'Open checkout', expectedResult: 'Form visible' },
        { action: 'Submit card', expectedResult: 'Success page' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(['payments', 'smoke']);
    expect(res.body.steps.map((s: { position: number }) => s.position)).toEqual([1, 2]);
    expect(res.body.status).toBe('DRAFT');
    caseId = res.body.id;
  });

  it('rejects a duplicate automation key in the same project', async () => {
    const res = await qa.client.post(`${base()}/test-cases`, { suiteId, title: 'Other', automationKey: 'PAY-001' });
    expect(res.status).toBe(409);
  });

  it('searches, filters, sorts and paginates', async () => {
    for (const [title, priority] of [
      ['Refund order', 'LOW'],
      ['Pay with expired card', 'CRITICAL'],
    ] as const) {
      await qa.client.post(`${base()}/test-cases`, { suiteId, title, priority, type: 'FUNCTIONAL' });
    }
    const search = await qa.client.get(`${base()}/test-cases?q=pay`);
    expect(search.body.total).toBe(2);
    const filtered = await qa.client.get(`${base()}/test-cases?priority=LOW`);
    expect(filtered.body.items.map((c: { title: string }) => c.title)).toEqual(['Refund order']);
    const byTag = await qa.client.get(`${base()}/test-cases?tag=smoke`);
    expect(byTag.body.total).toBe(1);
    const sorted = await qa.client.get(`${base()}/test-cases?sort=priority&order=asc`);
    expect(sorted.body.items[0].priority).toBe('CRITICAL');
    const page = await qa.client.get(`${base()}/test-cases?pageSize=2&page=2&sort=title&order=asc`);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(3);
    expect((await qa.client.get(`${base()}/test-cases?pageSize=1000`)).status).toBe(400);
  });

  it('updates steps atomically and duplicates a case without its automation key', async () => {
    const upd = await qa.client.patch(`${base()}/test-cases/${caseId}`, {
      status: 'READY',
      steps: [{ action: 'Only step', expectedResult: 'ok' }],
    });
    expect(upd.status).toBe(200);
    expect(upd.body.steps).toHaveLength(1);
    const dup = await qa.client.post(`${base()}/test-cases/${caseId}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.title).toBe('Pay with valid card (copy)');
    expect(dup.body.automationKey).toBeNull();
    expect(dup.body.status).toBe('DRAFT');
    expect(dup.body.steps).toHaveLength(1);
  });

  it('soft-deletes and prevents deleting a suite that still has cases', async () => {
    const created = await qa.client.post(`${base()}/test-cases`, { suiteId, title: 'Temporary' });
    expect((await qa.client.delete(`${base()}/test-cases/${created.body.id}`)).status).toBe(204);
    expect((await qa.client.get(`${base()}/test-cases/${created.body.id}`)).status).toBe(404);
    const row = await testPrisma().testCase.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.deletedAt).not.toBeNull();
    expect((await qa.client.delete(`${base()}/suites/${suiteId}`)).status).toBe(409);
  });
});

describe('plans, manual runs, bugs and dashboard', () => {
  let planId: string;
  let runId: string;
  let results: { id: string; title: string }[];

  it('creates a plan from a suite (expands its active cases)', async () => {
    const res = await qa.client.post(`${base()}/test-plans`, {
      name: 'Release 1.0',
      environment: 'staging',
      scope: 'Checkout regression',
      suiteIds: [suiteId],
    });
    expect(res.status).toBe(201);
    expect(res.body._count.cases).toBe(4);
    planId = res.body.id;
  });

  it('starts a run that snapshots NOT_RUN results for every case', async () => {
    const res = await qa.client.post(`${base()}/test-runs`, { testPlanId: planId, name: 'RC1' });
    expect(res.status).toBe(201);
    runId = res.body.id;
    const detail = await qa.client.get(`${base()}/test-runs/${runId}`);
    expect(detail.body.results).toHaveLength(4);
    expect(detail.body.summary.NOT_RUN).toBe(4);
    expect(detail.body.passRate).toBeNull();
    results = detail.body.results;
    const plan = await qa.client.get(`${base()}/test-plans/${planId}`);
    expect(plan.body.status).toBe('ACTIVE');
  });

  it('records results; execution status never changes the test case status', async () => {
    const statuses = ['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'] as const;
    for (const [i, r] of results.entries()) {
      const res = await qa.client.patch(`${base()}/test-runs/${runId}/results/${r.id}`, {
        status: statuses[i],
        actualResult: statuses[i] === 'FAILED' ? 'Error 500 on submit' : '',
        durationSeconds: 30,
      });
      expect(res.status).toBe(200);
      expect(res.body.executedBy.id).toBe(qa.userId);
      expect(res.body.durationMs).toBe(30_000);
    }
    const detail = await qa.client.get(`${base()}/test-runs/${runId}`);
    expect(detail.body.summary).toMatchObject({ PASSED: 1, FAILED: 1, BLOCKED: 1, SKIPPED: 1, NOT_RUN: 0 });
    expect(detail.body.passRate).toBeCloseTo(33.3, 1);
    const cases = await testPrisma().testCase.findMany({ where: { projectId, deletedAt: null } });
    expect(cases.every((c) => ['DRAFT', 'READY'].includes(c.status))).toBe(true);
  });

  it('files a bug linked to the failed result and tracks change history', async () => {
    const failed = results[1]!;
    const created = await qa.client.post(`${base()}/bugs`, {
      title: 'Card payment returns 500',
      severity: 'CRITICAL',
      priority: 'HIGH',
      stepsToReproduce: '1. Checkout\n2. Pay',
      browser: 'Chromium 158',
      testResultId: failed.id,
    });
    expect(created.status).toBe(201);
    const bugId = created.body.id;
    const upd = await qa.client.patch(`${base()}/bugs/${bugId}`, { status: 'IN_PROGRESS', assigneeId: qa.userId });
    expect(upd.status).toBe(200);
    const detail = await qa.client.get(`${base()}/bugs/${bugId}`);
    const fields = detail.body.history.map((h: { field: string }) => h.field);
    expect(fields).toEqual(expect.arrayContaining(['created', 'status', 'assigneeId']));
    const statusChange = detail.body.history.find((h: { field: string }) => h.field === 'status');
    expect(statusChange).toMatchObject({ fromValue: 'OPEN', toValue: 'IN_PROGRESS' });
    expect(detail.body.testResult.id).toBe(failed.id);

    const noop = await qa.client.patch(`${base()}/bugs/${bugId}`, { status: 'IN_PROGRESS' });
    expect(noop.status).toBe(200);
    const after = await qa.client.get(`${base()}/bugs/${bugId}`);
    expect(after.body.history).toHaveLength(detail.body.history.length);
  });

  it('closes the run and blocks further edits; plan with runs cannot be deleted', async () => {
    expect((await qa.client.post(`${base()}/test-runs/${runId}/complete`)).status).toBe(200);
    const edit = await qa.client.patch(`${base()}/test-runs/${runId}/results/${results[0]!.id}`, { status: 'FAILED' });
    expect(edit.status).toBe(409);
    expect((await qa.client.post(`${base()}/test-runs/${runId}/complete`)).status).toBe(409);
    expect((await qa.client.delete(`${base()}/test-plans/${planId}`)).status).toBe(409);
  });

  it('dashboard metrics are computed from the persisted data', async () => {
    const res = await qa.client.get(`/api/organizations/${qa.orgId}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ projects: 1, testCases: 4, openBugs: 1, criticalBugs: 1 });
    expect(res.body.results).toMatchObject({ PASSED: 1, FAILED: 1, BLOCKED: 1, SKIPPED: 1, total: 4 });
    expect(res.body.results.passRate).toBeCloseTo(33.3, 1);
    expect(res.body.executionHistory).toHaveLength(14);
    const today = res.body.executionHistory.at(-1);
    expect(today).toMatchObject({ PASSED: 1, FAILED: 1, BLOCKED: 1, SKIPPED: 1 });
    expect(res.body.bugsBySeverity).toEqual([{ severity: 'CRITICAL', count: 1 }]);
    expect(res.body.recentRuns[0].summary.PASSED).toBe(1);
    expect(res.body.recentActivity.length).toBeGreaterThan(0);

    const scoped = await qa.client.get(`${base()}/metrics`);
    expect(scoped.body.totals.testCases).toBe(4);
  });

  it('global search finds test cases and bugs', async () => {
    const res = await qa.client.get(`/api/organizations/${qa.orgId}/search?q=card`);
    expect(res.status).toBe(200);
    expect(res.body.testCases.length).toBeGreaterThan(0);
    expect(res.body.bugs[0].title).toBe('Card payment returns 500');
  });

  it('records an audit trail', async () => {
    const res = await qa.client.get(`/api/organizations/${qa.orgId}/audit-logs?pageSize=100`);
    const actions = res.body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['project.created', 'test_case.created', 'test_run.started', 'bug.created']));
  });
});

describe('run state under concurrency', () => {
  const startRun = async (name: string) => {
    const tc = await qa.client.post(`${base()}/test-cases`, { suiteId, title: `Race ${name}` });
    const plan = await qa.client.post(`${base()}/test-plans`, { name: `Race plan ${name}`, testCaseIds: [tc.body.id] });
    const run = await qa.client.post(`${base()}/test-runs`, { testPlanId: plan.body.id, name });
    const detail = await qa.client.get(`${base()}/test-runs/${run.body.id}`);
    return { runId: run.body.id as string, resultId: detail.body.results[0].id as string };
  };

  it('never records a result after the run was completed', async () => {
    for (let i = 0; i < 10; i++) {
      const { runId, resultId } = await startRun(`complete-${i}`);
      const [complete, update] = await Promise.all([
        qa.client.post(`${base()}/test-runs/${runId}/complete`),
        qa.client.patch(`${base()}/test-runs/${runId}/results/${resultId}`, { status: 'PASSED' }),
      ]);
      expect(complete.status).toBe(200);
      const after = await qa.client.get(`${base()}/test-runs/${runId}`);
      const result = after.body.results[0];
      if (update.status === 200) {
        expect(new Date(result.executedAt).getTime()).toBeLessThanOrEqual(new Date(after.body.finishedAt).getTime());
      } else {
        expect(update.status).toBe(409);
        expect(result.status).toBe('NOT_RUN');
      }
    }
  });

  it('only one of several simultaneous close requests succeeds', async () => {
    const { runId } = await startRun('double-close');
    const responses = await Promise.all([
      qa.client.post(`${base()}/test-runs/${runId}/abort`),
      qa.client.post(`${base()}/test-runs/${runId}/complete`),
      qa.client.post(`${base()}/test-runs/${runId}/abort`),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
});
