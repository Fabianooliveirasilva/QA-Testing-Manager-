import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createProject, createTestApp, registerAccount, resetDatabase, type Account } from './helpers.js';

const { app } = createTestApp();

let owner: Account;
let outsider: Account;
let viewer: Account;
let member: Account;
let project: { projectId: string; suiteId: string };
let testCaseId: string;
let bugId: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await registerAccount(app, 'Owner', 'Tenant A');
  outsider = await registerAccount(app, 'Outsider', 'Tenant B');
  viewer = await addMember(app, owner, 'VIEWER');
  member = await addMember(app, owner, 'MEMBER');
  project = await createProject(owner);
  const tc = await owner.client.post(`/api/projects/${project.projectId}/test-cases`, {
    suiteId: project.suiteId,
    title: 'Secret case',
  });
  testCaseId = tc.body.id;
  const bug = await owner.client.post(`/api/projects/${project.projectId}/bugs`, { title: 'Secret bug' });
  bugId = bug.body.id;
});

describe('organization isolation (IDOR)', () => {
  it.each([
    ['project', () => `/api/projects/${project.projectId}`],
    ['test cases list', () => `/api/projects/${project.projectId}/test-cases`],
    ['test case', () => `/api/projects/${project.projectId}/test-cases/${testCaseId}`],
    ['bug', () => `/api/projects/${project.projectId}/bugs/${bugId}`],
    ['organization', () => `/api/organizations/${owner.orgId}`],
    ['dashboard', () => `/api/organizations/${owner.orgId}/dashboard`],
    ['members', () => `/api/organizations/${owner.orgId}/members`],
  ])('outsider gets 404 for %s', async (_name, url) => {
    const res = await outsider.client.get(url());
    expect(res.status).toBe(404);
  });

  it('outsider cannot modify resources of another organization', async () => {
    const patch = await outsider.client.patch(`/api/projects/${project.projectId}/bugs/${bugId}`, { title: 'pwned' });
    expect(patch.status).toBe(404);
    const del = await outsider.client.delete(`/api/projects/${project.projectId}/test-cases/${testCaseId}`);
    expect(del.status).toBe(404);
  });

  it('cannot reach a resource through a project it does not belong to', async () => {
    const own = await createProject(outsider, 'Outsider project');
    const res = await outsider.client.get(`/api/projects/${own.projectId}/test-cases/${testCaseId}`);
    expect(res.status).toBe(404);
    const bug = await outsider.client.patch(`/api/projects/${own.projectId}/bugs/${bugId}`, { title: 'x' });
    expect(bug.status).toBe(404);
  });

  it('dashboard rejects a projectId from another organization', async () => {
    const own = await createProject(outsider, 'Other');
    const res = await owner.client.get(`/api/organizations/${owner.orgId}/dashboard?projectId=${own.projectId}`);
    expect(res.status).toBe(404);
  });

  it('rejects assigning users from another organization', async () => {
    const res = await owner.client.post(`/api/projects/${project.projectId}/bugs`, {
      title: 'Bug',
      assigneeId: outsider.userId,
    });
    expect(res.status).toBe(400);
  });

  it('rejects linking a bug to a test case of another project', async () => {
    const other = await createProject(outsider, 'Other 2');
    const foreignCase = await outsider.client.post(`/api/projects/${other.projectId}/test-cases`, {
      suiteId: other.suiteId,
      title: 'Foreign',
    });
    const res = await owner.client.post(`/api/projects/${project.projectId}/bugs`, {
      title: 'Bug',
      testCaseId: foreignCase.body.id,
    });
    expect(res.status).toBe(400);
  });

  it('rejects a test case in a suite from another project', async () => {
    const other = await createProject(outsider, 'Other 3');
    const res = await owner.client.post(`/api/projects/${project.projectId}/test-cases`, {
      suiteId: other.suiteId,
      title: 'x',
    });
    expect(res.status).toBe(400);
  });

  it('treats malformed ids as not found', async () => {
    const res = await owner.client.get(`/api/projects/not-a-uuid/test-cases`);
    expect(res.status).toBe(404);
    const res2 = await owner.client.get(`/api/projects/${project.projectId}/bugs/1%20OR%201=1`);
    expect(res2.status).toBe(404);
  });
});

describe('role-based access control', () => {
  it('viewer can read but not write', async () => {
    expect((await viewer.client.get(`/api/projects/${project.projectId}/test-cases`)).status).toBe(200);
    const create = await viewer.client.post(`/api/projects/${project.projectId}/test-cases`, {
      suiteId: project.suiteId,
      title: 'Nope',
    });
    expect(create.status).toBe(403);
    expect((await viewer.client.post(`/api/projects/${project.projectId}/bugs`, { title: 'x' })).status).toBe(403);
  });

  it('member can write test artifacts but not manage projects or members', async () => {
    const create = await member.client.post(`/api/projects/${project.projectId}/test-cases`, {
      suiteId: project.suiteId,
      title: 'Member case',
    });
    expect(create.status).toBe(201);
    expect((await member.client.post(`/api/organizations/${owner.orgId}/projects`, { name: 'x' })).status).toBe(403);
    expect((await member.client.post(`/api/projects/${project.projectId}/archive`)).status).toBe(403);
    expect(
      (await member.client.post(`/api/organizations/${owner.orgId}/members`, { email: outsider.email, role: 'ADMIN' }))
        .status,
    ).toBe(403);
    expect((await member.client.delete(`/api/projects/${project.projectId}/bugs/${bugId}`)).status).toBe(403);
    expect((await member.client.get(`/api/organizations/${owner.orgId}/audit-logs`)).status).toBe(403);
  });

  it('nobody can modify the owner membership; admins cannot grant OWNER', async () => {
    const admin = await addMember(app, owner, 'ADMIN');
    const members = await owner.client.get(`/api/organizations/${owner.orgId}/members`);
    const ownerMember = members.body.items.find((m: { role: string }) => m.role === 'OWNER');
    expect((await admin.client.delete(`/api/organizations/${owner.orgId}/members/${ownerMember.id}`)).status).toBe(403);
    const target = members.body.items.find((m: { userId: string }) => m.userId === viewer.userId);
    const promote = await admin.client.patch(`/api/organizations/${owner.orgId}/members/${target.id}`, { role: 'OWNER' });
    expect(promote.status).toBe(400);
  });

  it('removing a member revokes their access immediately', async () => {
    const temp = await addMember(app, owner, 'MEMBER');
    expect((await temp.client.get(`/api/projects/${project.projectId}`)).status).toBe(200);
    const members = await owner.client.get(`/api/organizations/${owner.orgId}/members`);
    const m = members.body.items.find((x: { userId: string }) => x.userId === temp.userId);
    expect((await owner.client.delete(`/api/organizations/${owner.orgId}/members/${m.id}`)).status).toBe(204);
    expect((await temp.client.get(`/api/projects/${project.projectId}`)).status).toBe(404);
  });

  it('archived projects are read-only', async () => {
    const p = await createProject(owner, 'To archive');
    expect((await owner.client.post(`/api/projects/${p.projectId}/archive`)).status).toBe(200);
    expect((await owner.client.get(`/api/projects/${p.projectId}/test-cases`)).status).toBe(200);
    const res = await owner.client.post(`/api/projects/${p.projectId}/test-cases`, { suiteId: p.suiteId, title: 'x' });
    expect(res.status).toBe(403);
    expect((await owner.client.post(`/api/projects/${p.projectId}/unarchive`)).status).toBe(200);
  });
});
