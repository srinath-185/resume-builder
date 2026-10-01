import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { envInt, envString } from '../../common/config/env.util';
import { AppConfigurationError, UpstreamHttpError } from '../../common/errors';
import { ResilientHttpClient } from '../../common/http/resilient-http.client';

export interface OutgoingMail {
  from: { name?: string; address: string };
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  /** RFC 5322 Message-ID we assign, so follow-ups can reference it. */
  messageId: string;
  inReplyTo?: string;
  threadId?: string;
}

export interface SentMail {
  messageId: string;
  threadId?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface GmailApi {
  isConfigured(): boolean;
  authUrl(state: string): string;
  exchange(code: string): Promise<{ refreshToken: string; email: string }>;
  send(refreshToken: string, mail: OutgoingMail): Promise<SentMail>;
}

export interface SmtpApi {
  verify(config: SmtpConfig): Promise<void>;
  send(config: SmtpConfig, mail: OutgoingMail): Promise<SentMail>;
}

/** Raised when Google rejects the stored refresh token (revoked, expired, password changed). */
export class GmailAuthError extends Error {}

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'];

function fromAddress(from: OutgoingMail['from']): { name: string; address: string } | string {
  return from.name ? { name: from.name, address: from.address } : from.address;
}

export async function composeMime(mail: OutgoingMail): Promise<Buffer> {
  const composer = new MailComposer({
    from: fromAddress(mail.from),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.inReplyTo,
    attachments: mail.attachments,
  });
  return composer.compile().build();
}

export function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Gmail through OAuth 2.0 with only the gmail.send scope: the app can send
 * as the user but can never read their mailbox. Gmail has no API-key option
 * for sending; OAuth (or SMTP with an App Password) is the only way.
 */
export class GoogleGmailApi implements GmailApi {
  private readonly http = new ResilientHttpClient({ name: 'gmail', timeoutMs: envInt('GMAIL_TIMEOUT_MS', 30_000), retries: 2 });

  isConfigured(): boolean {
    return Boolean(envString('GOOGLE_CLIENT_ID') && envString('GOOGLE_CLIENT_SECRET') && envString('GOOGLE_OAUTH_REDIRECT_URI'));
  }

  authUrl(state: string): string {
    return this.client().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GMAIL_SCOPES, state, include_granted_scopes: true });
  }

  async exchange(code: string): Promise<{ refreshToken: string; email: string }> {
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token || !tokens.id_token) throw new GmailAuthError('Google did not return an offline refresh token');
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: envString('GOOGLE_CLIENT_ID') });
    const email = ticket.getPayload()?.email;
    if (!email) throw new GmailAuthError('Google did not return the account email');
    return { refreshToken: tokens.refresh_token, email };
  }

  async send(refreshToken: string, mail: OutgoingMail): Promise<SentMail> {
    const client = this.client();
    client.setCredentials({ refresh_token: refreshToken });
    let accessToken: string | null | undefined;
    try {
      accessToken = (await client.getAccessToken()).token;
    } catch (error) {
      throw new GmailAuthError((error as Error).message);
    }
    if (!accessToken) throw new GmailAuthError('No access token');
    const raw = base64Url(await composeMime(mail));
    try {
      const response = await this.http.request<{ id?: string; threadId?: string }>({
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
        body: { raw, ...(mail.threadId ? { threadId: mail.threadId } : {}) },
      });
      return { messageId: mail.messageId, threadId: response.data?.threadId };
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.upstreamStatus === 401) throw new GmailAuthError('Gmail rejected the access token');
      throw error;
    }
  }

  private client(): OAuth2Client {
    if (!this.isConfigured()) throw new AppConfigurationError('Gmail OAuth is not configured on this server');
    return new OAuth2Client(envString('GOOGLE_CLIENT_ID'), envString('GOOGLE_CLIENT_SECRET'), envString('GOOGLE_OAUTH_REDIRECT_URI'));
  }
}

/** Any SMTP server, including Gmail with an App Password (smtp.gmail.com:465). */
export class NodemailerSmtpApi implements SmtpApi {
  async verify(config: SmtpConfig): Promise<void> {
    await this.transport(config).verify();
  }

  async send(config: SmtpConfig, mail: OutgoingMail): Promise<SentMail> {
    const info: { messageId?: string } = await this.transport(config).sendMail({
      from: fromAddress(mail.from),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.inReplyTo,
      attachments: mail.attachments,
    });
    return { messageId: info.messageId ?? mail.messageId };
  }

  private transport(config: SmtpConfig) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
}
