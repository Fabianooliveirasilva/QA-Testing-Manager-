import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailReceipt {
  provider: string;
  /** Provider message id; null when nothing was handed to a delivery service (log mailer). */
  id: string | null;
}

export type MailErrorKind = 'rejected' | 'rate_limited' | 'unavailable';

/** Delivery failed. Messages never contain the recipient, body or links. */
export class MailDeliveryError extends Error {
  constructor(
    public readonly kind: MailErrorKind,
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<MailReceipt>;
}

/**
 * Development mailer: writes messages to the log instead of sending them. In production the
 * body is never logged because it contains secrets (reset links).
 */
export class LogMailer implements Mailer {
  readonly name = 'log';

  constructor(
    private readonly logger: Logger,
    private readonly revealBody: boolean,
  ) {}

  async send(message: MailMessage): Promise<MailReceipt> {
    if (this.revealBody) {
      this.logger.info({ to: message.to, subject: message.subject, body: message.text }, 'email (dev mailer, not sent)');
    } else {
      this.logger.warn({ subject: message.subject }, 'email delivery is not configured; message was not sent');
    }
    return { provider: this.name, id: null };
  }
}

/** Collects messages in memory; used by the automated tests. */
export class MemoryMailer implements Mailer {
  readonly name = 'memory';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailReceipt> {
    this.sent.push(message);
    return { provider: this.name, id: `memory-${this.sent.length}` };
  }
}

const SENDER = /^(?:([^<>\r\n"]{1,100}?)\s*<([^<>\s]+)>|([^<>\s]+))$/;

/** Validates "Name <address@domain>" or "address@domain"; rejects header-injection characters. */
export function parseSender(value: string): { name: string | null; address: string } {
  const match = SENDER.exec(value.trim());
  const address = match?.[2] ?? match?.[3];
  if (!match || !address || !z.string().email().safeParse(address).success) {
    throw new Error('EMAIL_FROM must be "Name <address@your-domain>" or "address@your-domain"');
  }
  return { name: match[1]?.trim() || null, address };
}

export interface ResendOptions {
  apiKey: string;
  from: string;
  timeoutMs?: number;
  /** Test hook for a local stub of the API. */
  baseUrl?: string;
}

/** Resend REST adapter (POST /emails, https://resend.com/docs/api-reference/emails/send-email). */
export class ResendMailer implements Mailer {
  readonly name = 'resend';
  private readonly apiKey: string;
  private readonly from: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: ResendOptions) {
    if (!/^re_[A-Za-z0-9_-]{8,}$/.test(options.apiKey)) throw new Error('RESEND_API_KEY is missing or malformed');
    parseSender(options.from);
    this.apiKey = options.apiKey;
    this.from = options.from.trim();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.baseUrl = (options.baseUrl ?? 'https://api.resend.com').replace(/\/$/, '');
  }

  async send(message: MailMessage): Promise<MailReceipt> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // A retried request must not send the e-mail twice.
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new MailDeliveryError('unavailable', timedOut ? 'Email provider timed out' : 'Email provider is unreachable');
    }

    const body: unknown = await response.json().catch(() => null);
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (response.ok && typeof record.id === 'string') return { provider: this.name, id: record.id };

    const code = typeof record.name === 'string' ? record.name : undefined;
    if (response.ok) throw new MailDeliveryError('unavailable', 'Email provider returned an unexpected response', response.status);
    // Provider messages may echo addresses; only the status and error type are kept.
    const detail = `${response.status}${code ? ` ${code}` : ''}`;
    if (response.status === 429) throw new MailDeliveryError('rate_limited', `Email provider rate limit or quota reached (${detail})`, response.status, code);
    if (response.status >= 500) throw new MailDeliveryError('unavailable', `Email provider unavailable (${detail})`, response.status, code);
    throw new MailDeliveryError('rejected', `Email provider rejected the message (${detail})`, response.status, code);
  }
}

/** Returns null when e-mail is disabled: features that need delivery must then report themselves unavailable. */
export function createMailer(config: AppConfig, logger: Logger): Mailer | null {
  switch (config.EMAIL_PROVIDER) {
    case 'resend':
      return new ResendMailer({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM, timeoutMs: config.EMAIL_TIMEOUT_MS });
    case 'log':
      return new LogMailer(logger, config.NODE_ENV !== 'production');
    case 'none':
      return null;
  }
}
