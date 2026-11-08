/**
 * LIVE Resend delivery test — sends ONE real e-mail.
 *   RESEND_API_KEY=re_… EMAIL_FROM="QA Testing Manager <no-reply@your-verified-domain>" \
 *   pnpm --filter @qtm/api test:live:email
 * Recipient defaults to Resend's test inbox delivered@resend.dev (override with EMAIL_LIVE_TO).
 * A provider id proves Resend ACCEPTED the message; inbox delivery is visible in the Resend dashboard.
 */
import { describe, expect, it } from 'vitest';
import { passwordResetEmail } from '../src/services/email-templates.js';
import { ResendMailer } from '../src/services/mailer.js';

const KEY = process.env.RESEND_API_KEY ?? '';
const FROM = process.env.EMAIL_FROM ?? '';
const TO = process.env.EMAIL_LIVE_TO || 'delivered@resend.dev';
const configured = Boolean(KEY && FROM);
if (!configured) console.warn('[live] RESEND_API_KEY / EMAIL_FROM not set — live e-mail tests are SKIPPED (not verified).');

describe.skipIf(!configured)('Resend live API', () => {
  it('accepts a templated password-reset e-mail and returns a message id', async () => {
    const content = passwordResetEmail({ link: 'https://example.invalid/reset-password?token=live-test-not-a-real-token', minutes: 30, name: 'Live Test' });
    const receipt = await new ResendMailer({ apiKey: KEY, from: FROM }).send({ to: TO, ...content, subject: `[live test] ${content.subject}` });
    expect(receipt.provider).toBe('resend');
    expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);
    console.info(`[live] Resend accepted message ${receipt.id} for ${TO}`);
  });

  it('a revoked/invalid key is reported as a rejection, never as delivered', async () => {
    const error = await new ResendMailer({ apiKey: 're_invalid_live_test_key_000', from: FROM })
      .send({ to: TO, subject: '[live test] must not send', text: 'x' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'rejected' });
    expect(JSON.stringify(error)).not.toContain(KEY);
  });
});
