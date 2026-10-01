import { Application } from '@loopback/core';
import { MailTransportRegistryService } from '../../services/mail/mail-transport-registry.service';
import { GmailApi, GmailAuthError, OutgoingMail, SentMail, SmtpApi, SmtpConfig } from '../../services/mail/mail-transports';

export class FakeSmtp implements SmtpApi {
  sent: Array<{ config: SmtpConfig; mail: OutgoingMail }> = [];
  failVerify = false;

  async verify(): Promise<void> {
    if (this.failVerify) throw new Error('Invalid login: 535 bad credentials');
  }

  async send(config: SmtpConfig, mail: OutgoingMail): Promise<SentMail> {
    this.sent.push({ config, mail });
    return { messageId: mail.messageId };
  }
}

export class FakeGmail implements GmailApi {
  configured = true;
  failAuth = false;
  sent: Array<{ refreshToken: string; mail: OutgoingMail }> = [];

  isConfigured(): boolean {
    return this.configured;
  }

  authUrl(state: string): string {
    return `https://accounts.example.test/o/oauth2/auth?state=${encodeURIComponent(state)}`;
  }

  async exchange(code: string): Promise<{ refreshToken: string; email: string }> {
    return { refreshToken: `refresh-${code}`, email: 'me@gmail.example.test' };
  }

  async send(refreshToken: string, mail: OutgoingMail): Promise<SentMail> {
    if (this.failAuth) throw new GmailAuthError('invalid_grant');
    this.sent.push({ refreshToken, mail });
    return { messageId: mail.messageId, threadId: 'thread-1' };
  }
}

export async function useFakeMail(app: Application, smtp = new FakeSmtp(), gmail = new FakeGmail()): Promise<{ smtp: FakeSmtp; gmail: FakeGmail }> {
  (await app.get<MailTransportRegistryService>('services.MailTransportRegistryService')).replace({ smtp, gmail });
  return { smtp, gmail };
}

export const SMTP_SETTINGS = { host: 'smtp.example.test', port: 465, secure: true, user: 'priya', pass: 'app-password', senderEmail: 'priya@example.test', senderName: 'Priya Raman' };
