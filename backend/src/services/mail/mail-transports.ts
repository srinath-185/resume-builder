import { promises as dns } from 'dns';
import { OAuth2Client } from 'google-auth-library';
import { BlockList, isIP } from 'net';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { envBool, envInt, envString } from '../../common/config/env.util';
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

/** The SMTP host is (or resolves to) an address the server must not connect to on a user's behalf. */
export class SmtpHostNotAllowedError extends Error {}

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges. */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 127], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 0) return false;
  return !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Resolves a user-supplied SMTP host to one public address, so the server
 * cannot be pointed at its own network (SSRF). The caller connects to that
 * address, not the name, so a DNS answer cannot change between check and use.
 * SMTP_ALLOW_PRIVATE_HOSTS=true turns the check off for a self-hosted relay.
 */
export async function resolveSmtpAddress(host: string, lookup: (host: string) => Promise<string[]> = defaultLookup): Promise<string> {
  if (envBool('SMTP_ALLOW_PRIVATE_HOSTS', false)) return host;
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => [] as string[]);
  if (addresses.length === 0) throw new SmtpHostNotAllowedError(`SMTP host ${host} could not be resolved`);
  if (!addresses.every(isPublicAddress)) throw new SmtpHostNotAllowedError(`SMTP host ${host} points to a private or reserved address`);
  return addresses[0];
}

async function defaultLookup(host: string): Promise<string[]> {
  return (await dns.lookup(host, { all: true, verbatim: true })).map(entry => entry.address);
}

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
    await (await this.transport(config)).verify();
  }

  async send(config: SmtpConfig, mail: OutgoingMail): Promise<SentMail> {
    const info: { messageId?: string } = await (await this.transport(config)).sendMail({
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

  private async transport(config: SmtpConfig) {
    const address = await resolveSmtpAddress(config.host);
    return nodemailer.createTransport({
      host: address,
      port: config.port,
      // Certificates are still checked against the name the user entered.
      // (SNI may not carry an IP literal, so it is only set for names.)
      ...(isIP(config.host) ? {} : { tls: { servername: config.host } }),
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
}
