import type { Logger } from 'pino';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development mailer: writes messages to the log. No SMTP provider is bundled;
 * in production the message body is never logged because it contains secrets (reset links).
 */
export class LogMailer implements Mailer {
  constructor(
    private readonly logger: Logger,
    private readonly revealBody: boolean,
  ) {}

  async send(message: MailMessage): Promise<void> {
    if (this.revealBody) {
      this.logger.info({ to: message.to, subject: message.subject, body: message.text }, 'email (dev mailer)');
      return;
    }
    this.logger.warn(
      { to: message.to, subject: message.subject },
      'email delivery is not configured; message was not sent',
    );
  }
}

/** Collects messages in memory; used by the automated tests. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}
