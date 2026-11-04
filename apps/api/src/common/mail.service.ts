import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../config/env';

export interface Mail { to: string; subject: string; text: string; html: string }

/**
 * Outgoing e-mail. With RESEND_API_KEY set it sends through Resend (https://resend.com, free tier
 * is enough to start); without it the mail is only written to the log, so nothing breaks before a
 * provider is set up. Tests read `outbox`.
 */
@Injectable()
export class MailService {
  private log = new Logger('Mail');
  readonly outbox: Mail[] = [];

  constructor(@Inject(ENV) private env: Env) {}

  get enabled() {
    return !!this.env.resendApiKey;
  }

  async send(mail: Mail): Promise<boolean> {
    if (this.env.isTest) {
      this.outbox.push(mail);
      return true;
    }
    if (!this.env.resendApiKey) {
      this.log.warn(`no mail provider (RESEND_API_KEY): not sent to ${mail.to}: ${mail.subject}`);
      return false;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.env.mailFrom, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) {
        this.log.error(`mail to ${mail.to} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (e: any) {
      this.log.error(`mail to ${mail.to} failed: ${e?.message}`);
      return false;
    }
  }
}
