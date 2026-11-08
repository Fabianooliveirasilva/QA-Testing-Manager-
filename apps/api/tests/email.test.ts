import { Writable } from 'node:stream';
import { pino } from 'pino';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { MailDeliveryError, type MailMessage, type Mailer, type MailReceipt } from '../src/services/mailer.js';
import { createTestApp, registerAccount, resetDatabase, testPrisma } from './helpers.js';

beforeAll(resetDatabase);

/** Provider double that rejects every message the way the Resend adapter reports a rejection. */
class RejectingMailer implements Mailer {
  readonly name = 'rejecting-double';
  attempts: MailMessage[] = [];
  async send(message: MailMessage): Promise<MailReceipt> {
    this.attempts.push(message);
    throw new MailDeliveryError('rejected', 'Email provider rejected the message (403 validation_error)', 403, 'validation_error');
  }
}

function captureLogs() {
  const lines: string[] = [];
  return { lines, logger: pino({ level: 'debug' }, new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) })) };
}

describe('password reset e-mail', () => {
  it('sends a templated text + HTML e-mail whose link resets the password', async () => {
    const { app, mailer } = createTestApp();
    const acc = await registerAccount(app, 'Mail User');
    expect((await request(app).post('/api/auth/forgot-password').send({ email: acc.email })).status).toBe(202);
    const mail = mailer.sent.at(-1)!;
    expect(mail.subject).toBe('Reset your QA Testing Manager password');
    expect(mail.html).toContain('Reset password');
    const token = decodeURIComponent(/token=([^\s"<]+)/.exec(mail.text)![1]!);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'Mail-Reset-Pass-1' })).status).toBe(204);
  });

  it('when the provider rejects: same 202 (no enumeration), token invalidated, failure logged without link or address', async () => {
    const { lines, logger } = captureLogs();
    const rejecting = new RejectingMailer();
    const { app } = createTestApp({ mailer: rejecting, logger });
    const acc = await registerAccount(app, 'Rejected Mail');
    const res = await request(app).post('/api/auth/forgot-password').send({ email: acc.email });
    expect(res.status).toBe(202);
    expect(res.body.message).not.toMatch(/has been sent/);

    const token = decodeURIComponent(/token=([^\s"<]+)/.exec(rejecting.attempts[0]!.text)![1]!);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'Should-Fail-123' })).status).toBe(400);
    const user = await testPrisma().user.findUniqueOrThrow({ where: { email: acc.email } });
    expect(await testPrisma().passwordResetToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);

    const output = lines.join('');
    expect(output).toContain('password reset email was NOT delivered');
    expect(output).toContain('validation_error');
    expect(output).not.toContain(token);
    expect(output).not.toContain(acc.email);
  });

  it('without an e-mail provider, recovery reports itself unavailable for every address', async () => {
    const { app } = createTestApp({ mailer: null });
    const acc = await registerAccount(app, 'No Mail');
    const known = await request(app).post('/api/auth/forgot-password').send({ email: acc.email });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.test' });
    expect(known.status).toBe(503);
    expect(unknown.status).toBe(503);
    expect(known.body).toEqual(unknown.body);
    const caps = await request(app).get('/api/auth/capabilities');
    expect(caps.body).toEqual({ registration: true, passwordRecovery: false });
  });

  it('capabilities reflect configuration', async () => {
    const { app } = createTestApp({ env: { REGISTRATION_ENABLED: 'false' } });
    expect((await request(app).get('/api/auth/capabilities')).body).toEqual({ registration: false, passwordRecovery: true });
  });
});
