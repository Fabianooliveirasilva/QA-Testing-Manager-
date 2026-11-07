import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, PASSWORD, createTestApp, registerAccount, resetDatabase, testPrisma, uniqueEmail } from './helpers.js';

const { app, mailer } = createTestApp();

beforeAll(resetDatabase);

describe('registration', () => {
  it('creates user, organization (owner) and an httpOnly session cookie', async () => {
    const email = uniqueEmail('reg');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email, password: PASSWORD, organizationName: 'Ana Org' });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({ id: expect.any(String), name: 'Ana', email });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const session = cookies.find((c) => c.startsWith('qtm_session='));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(cookies.find((c) => c.startsWith('qtm_csrf='))).not.toMatch(/HttpOnly/i);

    const user = await testPrisma().user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const membership = await testPrisma().organizationMember.findFirstOrThrow({ where: { userId: user.id } });
    expect(membership.role).toBe('OWNER');
  });

  it('rejects weak passwords and invalid email with field details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'not-an-email', password: 'short', organizationName: 'X' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('rejects duplicate email with 409', async () => {
    const email = uniqueEmail('dup');
    const body = { name: 'A', email, password: PASSWORD, organizationName: 'X' };
    expect((await request(app).post('/api/auth/register').send(body)).status).toBe(201);
    expect((await request(app).post('/api/auth/register').send(body)).status).toBe(409);
  });
});

describe('login, session and logout', () => {
  it('logs in with valid credentials and exposes /me with organizations', async () => {
    const account = await registerAccount(app);
    const client = new Client(app);
    const res = await client.agent.post('/api/auth/login').send({ email: account.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const me = await client.refreshCsrf();
    expect(me.user.email).toBe(account.email);
    expect(me.organizations).toHaveLength(1);
    expect(me.organizations[0].role).toBe('OWNER');
  });

  it('returns the same generic 401 for unknown email and wrong password', async () => {
    const account = await registerAccount(app);
    const wrong = await request(app).post('/api/auth/login').send({ email: account.email, password: 'Wrong-password-1' });
    const unknown = await request(app).post('/api/auth/login').send({ email: uniqueEmail('nobody'), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    const account = await registerAccount(app);
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login').send({ email: account.email, password: 'Wrong-password-1' });
    }
    const user = await testPrisma().user.findUniqueOrThrow({ where: { email: account.email } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const res = await request(app).post('/api/auth/login').send({ email: account.email, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('requires authentication for protected routes', async () => {
    const res = await request(app).get('/api/organizations');
    expect(res.status).toBe(401);
  });

  it('logout invalidates the server-side session', async () => {
    const account = await registerAccount(app);
    expect((await account.client.post('/api/auth/logout')).status).toBe(204);
    expect((await account.client.get('/api/auth/me')).status).toBe(401);
    const sessions = await testPrisma().session.count({ where: { userId: account.userId } });
    expect(sessions).toBe(0);
  });

  it('rejects expired sessions', async () => {
    const account = await registerAccount(app);
    await testPrisma().session.updateMany({ where: { userId: account.userId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await account.client.get('/api/auth/me')).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the CSRF header', async () => {
    const account = await registerAccount(app);
    const res = await account.client.agent.post(`/api/organizations/${account.orgId}/projects`).send({ name: 'P' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/CSRF/);
  });

  it('rejects a CSRF token belonging to another session', async () => {
    const a = await registerAccount(app);
    const b = await registerAccount(app);
    const res = await a.client.agent
      .post(`/api/organizations/${a.orgId}/projects`)
      .set('x-csrf-token', b.client.csrf)
      .send({ name: 'P' });
    expect(res.status).toBe(403);
  });
});

describe('password reset', () => {
  it('sends a single-use reset link, changes the password and revokes sessions', async () => {
    const account = await registerAccount(app);
    const res = await request(app).post('/api/auth/forgot-password').send({ email: account.email });
    expect(res.status).toBe(202);
    const mail = mailer.sent.at(-1)!;
    expect(mail.to).toBe(account.email);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]!);

    const newPassword = 'An0ther-Strong-Pass';
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: newPassword })).status).toBe(204);
    expect((await account.client.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: newPassword })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: account.email, password: newPassword })).status).toBe(200);
  });

  it('responds identically for unknown emails and sends nothing', async () => {
    const before = mailer.sent.length;
    const res = await request(app).post('/api/auth/forgot-password').send({ email: uniqueEmail('ghost') });
    expect(res.status).toBe(202);
    expect(mailer.sent.length).toBe(before);
  });

  it('rejects expired tokens', async () => {
    const account = await registerAccount(app);
    await request(app).post('/api/auth/forgot-password').send({ email: account.email });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mailer.sent.at(-1)!.text)![1]!);
    await testPrisma().passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/api/auth/reset-password').send({ token, password: 'An0ther-Strong-Pass' });
    expect(res.status).toBe(400);
  });
});

describe('change password', () => {
  it('requires the current password and keeps only the current session', async () => {
    const account = await registerAccount(app);
    const other = new Client(app);
    await other.agent.post('/api/auth/login').send({ email: account.email, password: PASSWORD });

    const bad = await account.client.post('/api/auth/change-password', { currentPassword: 'nope', newPassword: 'Brand-New-Pass-1' });
    expect(bad.status).toBe(400);
    const ok = await account.client.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Brand-New-Pass-1' });
    expect(ok.status).toBe(204);
    expect((await account.client.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);
  });
});
