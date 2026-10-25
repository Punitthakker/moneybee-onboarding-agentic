import nodemailer from 'nodemailer';
import type { Config } from '../config';
import type { Logger } from '../logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** tenant-branded sender name, for example "Botim Business" */
  fromName?: string;
}

export interface Mailer {
  kind: 'smtp' | 'memory' | 'log';
  send(m: MailMessage): Promise<void>;
  /** memory mailer only: messages sent so far (tests and local demos) */
  outbox?: MailMessage[];
}

/**
 * Outbound email for magic links and notices.
 * smtp: any SMTP server (Mailpit in Docker, see http://localhost:8025). memory: kept in process for tests.
 * log: prints that a message was sent, never the link itself.
 */
export function createMailer(cfg: Config, log: Logger): Mailer {
  const kind = cfg.MAILER ?? (cfg.SMTP_URL ? 'smtp' : 'log');
  if (kind === 'memory') {
    const outbox: MailMessage[] = [];
    return { kind, outbox, async send(m) { outbox.push(m); } };
  }
  if (kind === 'smtp') {
    if (!cfg.SMTP_URL) throw new Error('MAILER=smtp needs SMTP_URL');
    const t = nodemailer.createTransport(cfg.SMTP_URL);
    const from = parseFrom(cfg.MAIL_FROM);
    return {
      kind,
      async send(m) {
        await t.sendMail({ from: { name: m.fromName ?? from.name, address: from.address }, to: m.to, subject: m.subject, text: m.text, html: m.html });
      },
    };
  }
  return {
    kind: 'log',
    async send(m) {
      log.warn({ to: m.to.replace(/^(.).*(@.*)$/, '$1***$2'), subject: m.subject }, 'MAILER=log: email not delivered (set SMTP_URL to send it)');
    },
  };
}

function parseFrom(s: string): { name: string; address: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
  return m ? { name: m[1] || 'MoneyBee Onboard', address: m[2] } : { name: 'MoneyBee Onboard', address: s.trim() };
}
