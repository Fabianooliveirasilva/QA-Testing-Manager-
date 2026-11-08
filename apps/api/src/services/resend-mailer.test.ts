import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailDeliveryError, ResendMailer, parseSender } from './mailer.js';

/** Local stand-in for the Resend HTTP API (external vendor). Real delivery is tested in tests-live. */
type Reply = { status: number; body: unknown; delayMs?: number };
let replies: Reply[] = [];
let requests: { headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
      const reply = replies.shift() ?? { status: 500, body: { name: 'application_error', message: 'no reply queued' } };
      setTimeout(() => {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  replies = [];
  requests = [];
});

const KEY = 're_test_0123456789abcdef';
const mailer = (timeoutMs = 2_000) => new ResendMailer({ apiKey: KEY, from: 'QA Testing Manager <no-reply@mail.example.com>', baseUrl, timeoutMs });
const message = { to: 'ana@example.com', subject: 'Reset', text: 'link https://app/reset?token=SECRET', html: '<a href="https://app/reset?token=SECRET">x</a>' };

describe('ResendMailer', () => {
  it('sends text + html with auth and an idempotency key, returning the provider id', async () => {
    replies.push({ status: 200, body: { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' } });
    await expect(mailer().send(message)).resolves.toEqual({ provider: 'resend', id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    const sent = requests[0]!;
    expect(sent.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(sent.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent.body).toEqual({
      from: 'QA Testing Manager <no-reply@mail.example.com>',
      to: ['ana@example.com'],
      subject: 'Reset',
      text: message.text,
      html: message.html,
    });
  });

  it.each([
    [403, 'validation_error', 'rejected'],
    [422, 'missing_required_field', 'rejected'],
    [401, 'validation_error', 'rejected'],
    [429, 'daily_quota_exceeded', 'rate_limited'],
    [429, 'rate_limit_exceeded', 'rate_limited'],
    [503, 'service_unavailable', 'unavailable'],
  ])('HTTP %i %s → %s, without echoing the provider message', async (status, name, kind) => {
    replies.push({ status, body: { name, message: 'Domain of ana@example.com is not verified' } });
    const error = await mailer().send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailDeliveryError);
    expect(error).toMatchObject({ kind, status, code: name });
    expect((error as Error).message).not.toContain('ana@example.com');
  });

  it('a 200 without an id is not treated as delivered', async () => {
    replies.push({ status: 200, body: { ok: true } });
    await expect(mailer().send(message)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('times out instead of hanging', async () => {
    replies.push({ status: 200, body: { id: 'late' }, delayMs: 1_500 });
    await expect(mailer(300).send(message)).rejects.toMatchObject({ kind: 'unavailable', message: 'Email provider timed out' });
  });

  it('reports an unreachable provider', async () => {
    const dead = new ResendMailer({ apiKey: KEY, from: 'a@example.com', baseUrl: 'http://127.0.0.1:1' });
    await expect(dead.send(message)).rejects.toMatchObject({ kind: 'unavailable', message: 'Email provider is unreachable' });
  });

  it('errors never contain the API key or the reset token', async () => {
    replies.push({ status: 401, body: { name: 'validation_error', message: `bad key ${KEY} token=SECRET` } });
    const error = await mailer().send(message).catch((e: unknown) => e);
    expect(JSON.stringify(error) + String((error as Error).message)).not.toMatch(/re_test|SECRET/);
  });
});

describe('configuration validation', () => {
  it.each(['', 'sk-123', 're_short'])('rejects malformed API key %j', (apiKey) => {
    expect(() => new ResendMailer({ apiKey, from: 'a@example.com' })).toThrow(/RESEND_API_KEY/);
  });

  it.each(['not-an-email', 'Name <bad>', 'Evil\r\nBcc: x@y.com <a@b.com>', 'a@b.com\nBcc: c@d.com', '<a@b.com'])('rejects sender %j', (from) => {
    expect(() => parseSender(from)).toThrow(/EMAIL_FROM/);
  });

  it.each([
    ['no-reply@mail.example.com', { name: null, address: 'no-reply@mail.example.com' }],
    ['QA Testing Manager <no-reply@mail.example.com>', { name: 'QA Testing Manager', address: 'no-reply@mail.example.com' }],
  ])('accepts sender %j', (from, parsed) => {
    expect(parseSender(from)).toEqual(parsed);
  });
});
