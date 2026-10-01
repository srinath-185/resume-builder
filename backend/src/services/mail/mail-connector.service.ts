import { BindingScope, inject, injectable } from '@loopback/core';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { envList, requiredEnv } from '../../common/config/env.util';
import { AppBusinessError, AppValidationError, ERROR_CODES } from '../../common/errors';
import { MailConnector, MailConnectorStatus, MailProvider } from '../../models';
import { MailConnectorRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption.service';
import { LoggerService } from '../common/logger.service';
import { MailTransportRegistryService } from './mail-transport-registry.service';
import { GmailAuthError, OutgoingMail, SentMail, SmtpConfig, SmtpHostNotAllowedError } from './mail-transports';

export interface MailConnectorView {
  connected: boolean;
  gmailAvailable: boolean;
  provider?: MailProvider;
  senderEmail?: string;
  senderName?: string;
  status?: MailConnectorStatus;
  lastError?: string;
  lastUsedAt?: Date;
}

export interface SmtpInput extends SmtpConfig {
  senderEmail: string;
  senderName?: string;
}

export type MailToSend = Omit<OutgoingMail, 'from' | 'messageId'> & { messageId?: string };

const STATE_AUDIENCE = 'gmail-connect';
const PENDING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SMTP_PORTS = ['25', '465', '587', '2525'];

/** A Gmail grant waiting for the signed-in user to claim it (see completeGmail). */
interface PendingGmail {
  userId: string;
  refreshToken: string;
  email: string;
  expiresAt: number;
}

function allowedSmtpPorts(): number[] {
  return envList('SMTP_ALLOWED_PORTS', DEFAULT_SMTP_PORTS).map(Number).filter(Number.isInteger);
}

function senderDomain(email: string): string {
  return email.split('@')[1] ?? 'resume-builder.local';
}

/**
 * Connects the user's own mailbox (Gmail OAuth or SMTP) and sends through it.
 * Secrets are encrypted at rest; a send that fails authentication marks the
 * connector ERROR so the UI can ask the user to reconnect.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class MailConnectorService {
  constructor(
    @inject('repositories.MailConnectorRepository') private connectors: MailConnectorRepository,
    @inject('services.MailTransportRegistryService') private transports: MailTransportRegistryService,
    @inject('services.EncryptionService') private encryption: EncryptionService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  async view(userId: string): Promise<MailConnectorView> {
    const connector = await this.connectors.findOne({ where: { userId } });
    const gmailAvailable = this.transports.gmail.isConfigured();
    if (!connector) return { connected: false, gmailAvailable };
    return {
      connected: connector.status === MailConnectorStatus.CONNECTED,
      gmailAvailable,
      provider: connector.provider,
      senderEmail: connector.senderEmail,
      senderName: connector.senderName,
      status: connector.status,
      lastError: connector.lastError,
      lastUsedAt: connector.lastUsedAt,
    };
  }

  startGmail(userId: string): { url: string } {
    if (!this.transports.gmail.isConfigured()) throw new AppBusinessError(ERROR_CODES.GMAIL_NOT_CONFIGURED, 'Gmail sign-in is not set up on this server; use SMTP instead');
    const state = jwt.sign({ sub: userId, nonce: randomUUID() }, requiredEnv('JWT_SECRET'), { audience: STATE_AUDIENCE, expiresIn: '10m' });
    return { url: this.transports.gmail.authUrl(state) };
  }

  /**
   * OAuth callback (unauthenticated: the browser arrives from Google). The
   * grant is not saved here. It is sealed into an encrypted, short-lived
   * "pending" token that the app sends back with the signed-in user's bearer
   * token (confirmGmail). Without that step anyone could send a victim their
   * own consent link and have the victim's mailbox attached to their account.
   */
  async completeGmail(code: string, state: string): Promise<string> {
    let userId: string;
    try {
      userId = String((jwt.verify(state, requiredEnv('JWT_SECRET'), { audience: STATE_AUDIENCE }) as jwt.JwtPayload).sub);
    } catch {
      throw new AppValidationError(ERROR_CODES.OAUTH_STATE_INVALID, 'The sign-in link expired; start again');
    }
    let result: { refreshToken: string; email: string };
    try {
      result = await this.transports.gmail.exchange(code);
    } catch (error) {
      this.logger.warn('Gmail connect failed', { userId, error: (error as Error).message });
      throw new AppBusinessError(ERROR_CODES.MAIL_CONNECT_FAILED, 'Google sign-in did not complete');
    }
    const pending: PendingGmail = { userId, refreshToken: result.refreshToken, email: result.email, expiresAt: Date.now() + PENDING_TTL_MS };
    return this.encryption.encryptJson(pending);
  }

  /** Saves a pending Gmail grant, but only for the user who started the sign-in. */
  async confirmGmail(userId: string, pendingToken: string): Promise<MailConnectorView> {
    let pending: PendingGmail;
    try {
      pending = this.encryption.decryptJson<PendingGmail>(pendingToken);
    } catch {
      throw new AppValidationError(ERROR_CODES.OAUTH_STATE_INVALID, 'The sign-in link expired; start again');
    }
    if (pending.userId !== userId || !(pending.expiresAt > Date.now())) {
      if (pending.userId !== userId) this.logger.warn('Gmail grant claimed by a different user', { userId, startedBy: pending.userId });
      throw new AppValidationError(ERROR_CODES.OAUTH_STATE_INVALID, 'The sign-in link expired; start again');
    }
    await this.save(userId, MailProvider.GMAIL, pending.email, undefined, this.encryption.encrypt(pending.refreshToken));
    return this.view(userId);
  }

  async saveSmtp(userId: string, input: SmtpInput): Promise<MailConnectorView> {
    const config: SmtpConfig = { host: input.host.trim(), port: input.port, secure: input.secure, user: input.user.trim(), pass: input.pass };
    if (!allowedSmtpPorts().includes(config.port)) {
      throw new AppValidationError(ERROR_CODES.SMTP_HOST_NOT_ALLOWED, `SMTP port must be one of ${allowedSmtpPorts().join(', ')}`);
    }
    try {
      await this.transports.smtp.verify(config);
    } catch (error) {
      if (error instanceof SmtpHostNotAllowedError) throw new AppValidationError(ERROR_CODES.SMTP_HOST_NOT_ALLOWED, error.message);
      throw new AppBusinessError(ERROR_CODES.MAIL_CONNECT_FAILED, `SMTP login failed: ${(error as Error).message}`.slice(0, 300));
    }
    await this.save(userId, MailProvider.SMTP, input.senderEmail.trim().toLowerCase(), input.senderName?.trim(), this.encryption.encryptJson(config));
    return this.view(userId);
  }

  async disconnect(userId: string): Promise<void> {
    const connector = await this.connectors.findOne({ where: { userId } });
    if (!connector) return;
    await this.connectors.deleteById(connector.id!);
    await this.audit.record({ userId, action: 'MAIL_DISCONNECTED', entity: 'MailConnector', entityId: connector.id });
  }

  async send(userId: string, mail: MailToSend): Promise<SentMail & { provider: MailProvider }> {
    const connector = await this.connectors.findOne({ where: { userId } });
    if (!connector || connector.status !== MailConnectorStatus.CONNECTED) {
      throw new AppBusinessError(ERROR_CODES.MAIL_NOT_CONNECTED, 'Connect Gmail or SMTP before sending email');
    }
    const outgoing: OutgoingMail = {
      ...mail,
      from: { name: connector.senderName, address: connector.senderEmail },
      messageId: mail.messageId ?? `<${randomUUID()}@${senderDomain(connector.senderEmail)}>`,
    };
    try {
      const sent =
        connector.provider === MailProvider.GMAIL
          ? await this.transports.gmail.send(this.encryption.decrypt(connector.encryptedSecret), outgoing)
          : await this.transports.smtp.send(this.encryption.decryptJson<SmtpConfig>(connector.encryptedSecret), outgoing);
      await this.connectors.updateById(connector.id!, { lastUsedAt: new Date(), lastError: undefined });
      return { ...sent, provider: connector.provider };
    } catch (error) {
      if (error instanceof GmailAuthError || /invalid login|authentication|535/i.test((error as Error).message)) {
        await this.connectors.updateById(connector.id!, { status: MailConnectorStatus.ERROR, lastError: 'Sign-in expired; reconnect your mailbox' });
        throw new AppBusinessError(ERROR_CODES.MAIL_AUTH_EXPIRED, 'Your mailbox connection expired; reconnect it');
      }
      throw error;
    }
  }

  async sendTest(userId: string): Promise<SentMail> {
    const connector = await this.connectors.findOne({ where: { userId } });
    if (!connector) throw new AppBusinessError(ERROR_CODES.MAIL_NOT_CONNECTED, 'Connect Gmail or SMTP first');
    return this.send(userId, { to: connector.senderEmail, subject: 'Resume Builder: test email', text: 'Your mailbox is connected. Outreach emails will be sent from this address.' });
  }

  async senderOf(userId: string): Promise<MailConnector | null> {
    return this.connectors.findOne({ where: { userId } });
  }

  private async save(userId: string, provider: MailProvider, senderEmail: string, senderName: string | undefined, encryptedSecret: string): Promise<void> {
    const existing = await this.connectors.findOne({ where: { userId } });
    const data = { provider, senderEmail, senderName, encryptedSecret, status: MailConnectorStatus.CONNECTED, lastError: undefined };
    if (existing) await this.connectors.updateById(existing.id!, data);
    else await this.connectors.create({ userId, ...data });
    await this.audit.record({ userId, action: 'MAIL_CONNECTED', entity: 'MailConnector', meta: { provider, senderEmail } });
  }
}
