import { BindingScope, inject, injectable } from '@loopback/core';
import { AppValidationError, ERROR_CODES } from '../../common/errors';
import { PortalSession, PortalSessionStatus } from '../../models';
import { PortalSessionRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption.service';
import { ApplyContext } from './apply-strategies';

export const SUPPORTED_PORTALS = ['linkedin'] as const;
export type Portal = (typeof SUPPORTED_PORTALS)[number];

export type Cookie = NonNullable<ApplyContext['cookies']>[number];

export interface PortalSessionInput {
  /** Cookies exported from the user's browser. */
  cookies?: Cookie[];
  /** Shortcut for LinkedIn: the value of the `li_at` cookie. */
  liAt?: string;
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

@injectable({ scope: BindingScope.TRANSIENT })
export class PortalSessionService {
  constructor(
    @inject('repositories.PortalSessionRepository') private sessions: PortalSessionRepository,
    @inject('services.EncryptionService') private encryption: EncryptionService,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  list(userId: string): Promise<PortalSession[]> {
    return this.sessions.findOwned(userId);
  }

  async save(userId: string, portal: string, input: PortalSessionInput): Promise<PortalSession> {
    if (!(SUPPORTED_PORTALS as readonly string[]).includes(portal)) throw new AppValidationError(ERROR_CODES.PORTAL_UNSUPPORTED, `Sessions are only used for: ${SUPPORTED_PORTALS.join(', ')}`);
    const cookies: Cookie[] = [...(input.cookies ?? [])];
    if (input.liAt) cookies.push({ name: 'li_at', value: input.liAt.trim(), domain: '.linkedin.com', path: '/', secure: true, httpOnly: true });
    if (cookies.length === 0 || cookies.some(cookie => !COOKIE_NAME.test(cookie.name) || !cookie.value)) {
      throw new AppValidationError(ERROR_CODES.VALIDATION_ERROR, 'Provide at least one valid cookie');
    }
    const data = { encryptedCookies: this.encryption.encryptJson(cookies), cookieCount: cookies.length, status: PortalSessionStatus.VALID };
    const existing = await this.sessions.findOne({ where: { userId, portal } });
    const saved = existing ? (await this.sessions.updateById(existing.id!, data), await this.sessions.findById(existing.id!)) : await this.sessions.create({ userId, portal, ...data });
    await this.audit.record({ userId, action: 'PORTAL_SESSION_SAVED', entity: 'PortalSession', entityId: saved.id, meta: { portal, cookies: cookies.length } });
    return saved;
  }

  async delete(userId: string, portal: string): Promise<void> {
    const existing = await this.sessions.findOne({ where: { userId, portal } });
    if (existing) await this.sessions.deleteById(existing.id!);
  }

  async cookiesFor(userId: string, portal: Portal): Promise<Cookie[] | undefined> {
    const session = await this.sessions.findOne({ where: { userId, portal, status: PortalSessionStatus.VALID } });
    if (!session) return undefined;
    await this.sessions.updateById(session.id!, { lastUsedAt: new Date() });
    return this.encryption.decryptJson<Cookie[]>(session.encryptedCookies);
  }

  async markExpired(userId: string, portal: Portal): Promise<void> {
    await this.sessions.updateAll({ status: PortalSessionStatus.EXPIRED }, { userId, portal });
  }
}
