import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createProject, createTestApp, registerAccount, resetDatabase, testPrisma, uniqueEmail, type Account } from './helpers.js';

const { app, ctx } = createTestApp();
let owner: Account;
let other: Account;
let p: { projectId: string; suiteId: string };
const base = () => `/api/projects/${p.projectId}`;

beforeAll(async () => {
  await resetDatabase();
  owner = await registerAccount(app, 'Rules Owner', 'Rules Org');
  other = await registerAccount(app, 'Rules Other', 'Other Org');
  p = await createProject(owner, 'Rules');
});

describe('test plans', () => {
  it('rejects suites and cases from another project or organization', async () => {
    const foreign = await createProject(other, 'Foreign');
    const foreignCase = await other.client.post(`/api/projects/${foreign.projectId}/test-cases`, { suiteId: foreign.suiteId, title: 'f' });
    expect((await owner.client.post(`${base()}/test-plans`, { name: 'x', suiteIds: [foreign.suiteId] })).status).toBe(400);
    expect((await owner.client.post(`${base()}/test-plans`, { name: 'x', testCaseIds: [foreignCase.body.id] })).status).toBe(400);
  });

  it('excludes deprecated cases, replaces the case set on update and validates runs', async () => {
    const ready = await owner.client.post(`${base()}/test-cases`, { suiteId: p.suiteId, title: 'Ready', status: 'READY' });
    const deprecated = await owner.client.post(`${base()}/test-cases`, { suiteId: p.suiteId, title: 'Old', status: 'DEPRECATED' });
    expect((await owner.client.post(`${base()}/test-plans`, { name: 'x', testCaseIds: [deprecated.body.id] })).status).toBe(400);

    const plan = await owner.client.post(`${base()}/test-plans`, { name: 'Suite plan', suiteIds: [p.suiteId] });
    expect(plan.body._count.cases).toBe(1);
    const emptied = await owner.client.patch(`${base()}/test-plans/${plan.body.id}`, { testCaseIds: [] });
    expect(emptied.body._count.cases).toBe(0);
    const run = await owner.client.post(`${base()}/test-runs`, { testPlanId: plan.body.id, name: 'empty' });
    expect(run.status).toBe(400);

    await owner.client.patch(`${base()}/test-plans/${plan.body.id}`, { testCaseIds: [ready.body.id], status: 'ARCHIVED' });
    expect((await owner.client.post(`${base()}/test-runs`, { testPlanId: plan.body.id, name: 'archived' })).status).toBe(409);
    expect((await owner.client.delete(`${base()}/test-plans/${plan.body.id}`)).status).toBe(204);
    expect((await owner.client.get(`${base()}/test-plans/${plan.body.id}`)).status).toBe(404);
  });

  it('a run cannot be started from a plan of another project', async () => {
    const foreign = await createProject(other, 'Foreign plan project');
    const fc = await other.client.post(`/api/projects/${foreign.projectId}/test-cases`, { suiteId: foreign.suiteId, title: 'f' });
    const fp = await other.client.post(`/api/projects/${foreign.projectId}/test-plans`, { name: 'fp', testCaseIds: [fc.body.id] });
    expect((await owner.client.post(`${base()}/test-runs`, { testPlanId: fp.body.id, name: 'steal' })).status).toBe(400);
  });
});

describe('projects, suites, team and tokens', () => {
  it('suite rules: rename, delete only when it never held cases', async () => {
    const suite = await owner.client.post(`${base()}/suites`, { name: 'Temp suite' });
    expect((await owner.client.patch(`${base()}/suites/${suite.body.id}`, { name: 'Renamed suite' })).body.name).toBe('Renamed suite');
    const tc = await owner.client.post(`${base()}/test-cases`, { suiteId: suite.body.id, title: 'in suite' });
    await owner.client.delete(`${base()}/test-cases/${tc.body.id}`);
    expect((await owner.client.delete(`${base()}/suites/${suite.body.id}`)).status).toBe(409);
    const empty = await owner.client.post(`${base()}/suites`, { name: 'Empty suite' });
    expect((await owner.client.delete(`${base()}/suites/${empty.body.id}`)).status).toBe(204);
    expect((await owner.client.patch(`${base()}/suites/${empty.body.id}`, { name: 'x' })).status).toBe(404);
  });

  it('team: only organization members can be added; removing unknown members is 404', async () => {
    const member = await addMember(app, owner, 'MEMBER');
    expect((await owner.client.post(`${base()}/members`, { userId: member.userId })).status).toBe(201);
    expect((await owner.client.post(`${base()}/members`, { userId: other.userId })).status).toBe(400);
    expect((await owner.client.delete(`${base()}/members/${member.userId}`)).status).toBe(204);
    expect((await owner.client.delete(`${base()}/members/${member.userId}`)).status).toBe(404);
    expect((await owner.client.patch(base(), { leadId: other.userId })).status).toBe(400);
  });

  it('tokens: hashed at rest, revocation is idempotent-safe, viewers cannot list them', async () => {
    const token = await owner.client.post(`${base()}/tokens`, { name: 'CI' });
    const row = await testPrisma().apiToken.findUniqueOrThrow({ where: { id: token.body.id } });
    expect(row.tokenHash).not.toContain(token.body.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await owner.client.delete(`${base()}/tokens/${token.body.id}`)).status).toBe(204);
    expect((await owner.client.delete(`${base()}/tokens/${token.body.id}`)).status).toBe(404);
    const viewer = await addMember(app, owner, 'VIEWER');
    expect((await viewer.client.get(`${base()}/tokens`)).status).toBe(403);
  });
});

describe('organizations and members', () => {
  it('creates additional organizations and validates member operations', async () => {
    const created = await owner.client.post('/api/organizations', { name: 'Second Org' });
    expect(created.status).toBe(201);
    expect(created.body.role).toBe('OWNER');
    const orgs = await owner.client.get('/api/organizations');
    expect(orgs.body.items).toHaveLength(2);

    const url = `/api/organizations/${owner.orgId}/members`;
    expect((await owner.client.post(url, { email: uniqueEmail('ghost'), role: 'MEMBER' })).status).toBe(404);
    const m = await addMember(app, owner, 'MEMBER');
    expect((await owner.client.post(url, { email: m.email, role: 'MEMBER' })).status).toBe(409);
    const list = await owner.client.get(url);
    const self = list.body.items.find((x: { userId: string }) => x.userId === owner.userId);
    expect((await owner.client.patch(`${url}/${self.id}`, { role: 'ADMIN' })).status).toBe(403);
    const admin = await addMember(app, owner, 'ADMIN');
    const adminRow = (await owner.client.get(url)).body.items.find((x: { userId: string }) => x.userId === admin.userId);
    expect((await admin.client.patch(`${url}/${adminRow.id}`, { role: 'VIEWER' })).status).toBe(400);
    expect((await owner.client.patch(`${url}/not-a-uuid`, { role: 'VIEWER' })).status).toBe(404);
  });
});

describe('bugs', () => {
  it('filters by status/severity, records link changes and deletes evidence files with the bug', async () => {
    const tc = await owner.client.post(`${base()}/test-cases`, { suiteId: p.suiteId, title: 'Linked case' });
    const bug = await owner.client.post(`${base()}/bugs`, { title: 'Filter me', severity: 'LOW' });
    await owner.client.post(`${base()}/bugs`, { title: 'Other', severity: 'CRITICAL' });
    expect((await owner.client.get(`${base()}/bugs?severity=LOW&q=filter`)).body.total).toBe(1);
    expect((await owner.client.get(`${base()}/bugs?status=CLOSED`)).body.total).toBe(0);

    await owner.client.patch(`${base()}/bugs/${bug.body.id}`, { testCaseId: tc.body.id, status: 'RESOLVED' });
    const detail = await owner.client.get(`${base()}/bugs/${bug.body.id}`);
    expect(detail.body.history.map((h: { field: string }) => h.field)).toEqual(expect.arrayContaining(['testCaseId', 'status']));

    const upload = await owner.client
      .post(`${base()}/attachments`)
      .field('entityType', 'BUG')
      .field('entityId', bug.body.id)
      .attach('file', Buffer.from('evidence'), { filename: 'e.txt', contentType: 'text/plain' });
    const stored = await testPrisma().attachment.findUniqueOrThrow({ where: { id: upload.body.id } });
    expect((await ctx.storage.get(stored.storageKey)).toString()).toBe('evidence');

    expect((await owner.client.delete(`${base()}/bugs/${bug.body.id}`)).status).toBe(204);
    expect(await testPrisma().attachment.count({ where: { id: upload.body.id } })).toBe(0);
    await expect(ctx.storage.get(stored.storageKey)).rejects.toThrow(/ENOENT/);
  });
});
