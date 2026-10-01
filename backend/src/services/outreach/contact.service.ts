import { BindingScope, inject, injectable } from '@loopback/core';
import { AppConflictError, ERROR_CODES } from '../../common/errors';
import { ContactSource, RecruiterContact } from '../../models';
import { normaliseEmail, RecruiterContactRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';

export interface ContactInput {
  email: string;
  name?: string;
  company?: string;
}

export interface ContactUpdate {
  name?: string | null;
  company?: string | null;
  doNotContact?: boolean;
}

@injectable({ scope: BindingScope.TRANSIENT })
export class ContactService {
  constructor(
    @inject('repositories.RecruiterContactRepository') private contacts: RecruiterContactRepository,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  list(userId: string): Promise<RecruiterContact[]> {
    return this.contacts.findOwned(userId, { order: ['createdAt DESC'], limit: 500 });
  }

  get(userId: string, id: string): Promise<RecruiterContact> {
    return this.contacts.findOwnedById(userId, id, {}, ERROR_CODES.CONTACT_NOT_FOUND);
  }

  async create(userId: string, input: ContactInput): Promise<RecruiterContact> {
    const email = normaliseEmail(input.email);
    if (await this.contacts.findOne({ where: { userId, email } })) {
      throw new AppConflictError(ERROR_CODES.CONTACT_EXISTS, 'This contact already exists');
    }
    const contact = await this.contacts.create({
      userId,
      email,
      name: input.name?.trim() || undefined,
      company: input.company?.trim() || undefined,
      source: ContactSource.MANUAL,
      doNotContact: false,
    });
    await this.audit.record({ userId, action: 'CONTACT_CREATED', entity: 'RecruiterContact', entityId: contact.id, after: { email } });
    return contact;
  }

  /** Adds contacts found in a post or job; existing contacts (and their do-not-contact flag) are left alone. */
  async upsertDiscovered(userId: string, emails: string[], source: ContactSource, sourceId: string, name?: string): Promise<number> {
    let created = 0;
    for (const raw of emails) {
      const email = normaliseEmail(raw);
      if (await this.contacts.findOne({ where: { userId, email } })) continue;
      await this.contacts.create({ userId, email, name: emails.length === 1 ? name : undefined, source, sourceId, doNotContact: false });
      created++;
    }
    return created;
  }

  async update(userId: string, id: string, patch: ContactUpdate): Promise<RecruiterContact> {
    const before = await this.get(userId, id);
    const data: Partial<RecruiterContact> = {};
    if (patch.name !== undefined) data.name = patch.name?.trim() || undefined;
    if (patch.company !== undefined) data.company = patch.company?.trim() || undefined;
    if (patch.doNotContact !== undefined) data.doNotContact = patch.doNotContact;
    await this.contacts.updateById(id, data);
    await this.audit.record({ userId, action: 'CONTACT_UPDATED', entity: 'RecruiterContact', entityId: id, before: { doNotContact: before.doNotContact }, after: data });
    return this.get(userId, id);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.contacts.deleteOwnedById(userId, id);
    await this.audit.record({ userId, action: 'CONTACT_DELETED', entity: 'RecruiterContact', entityId: id });
  }

  async markContacted(id: string): Promise<void> {
    await this.contacts.updateById(id, { lastContactedAt: new Date() });
  }
}
