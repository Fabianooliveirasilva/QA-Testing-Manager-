import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { LogMailer } from './mailer.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { logger: pino({ level: 'info' }, stream), lines };
}

const message = { to: 'ana@example.com', subject: 'Reset', text: 'https://app/reset-password?token=SECRET-TOKEN' };

describe('LogMailer', () => {
  it('in development, logs the message body so the reset link is usable locally', async () => {
    const { logger, lines } = capture();
    await new LogMailer(logger, true).send(message);
    expect(lines.join('')).toContain('SECRET-TOKEN');
  });

  it('in production, never logs the body (it contains a secret) and warns that nothing was sent', async () => {
    const { logger, lines } = capture();
    await new LogMailer(logger, false).send(message);
    const output = lines.join('');
    expect(output).not.toContain('SECRET-TOKEN');
    expect(output).toContain('email delivery is not configured');
    expect(JSON.parse(lines[0]!).level).toBe(40);
  });
});
