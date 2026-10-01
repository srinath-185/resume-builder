import { BindingScope, inject, injectable } from '@loopback/core';
import { AppBusinessError, AppValidationError, ERROR_CODES } from '../../common/errors';
import { DEFAULT_TEMPLATE, unknownPlaceholders } from '../../domain/template-render';
import { OutreachTemplate } from '../../models';
import { OutreachTemplateRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';

export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
  isDefault?: boolean;
}

@injectable({ scope: BindingScope.TRANSIENT })
export class OutreachTemplateService {
  constructor(
    @inject('repositories.OutreachTemplateRepository') private templates: OutreachTemplateRepository,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  /** Seeds the default template on first use so outreach works out of the box. */
  async list(userId: string): Promise<OutreachTemplate[]> {
    const existing = await this.templates.findOwned(userId, { order: ['createdAt ASC'] });
    if (existing.length > 0) return existing;
    return [await this.templates.create({ userId, ...DEFAULT_TEMPLATE, isDefault: true })];
  }

  get(userId: string, id: string): Promise<OutreachTemplate> {
    return this.templates.findOwnedById(userId, id, {}, ERROR_CODES.OUTREACH_TEMPLATE_NOT_FOUND);
  }

  async defaultFor(userId: string): Promise<OutreachTemplate> {
    const all = await this.list(userId);
    return all.find(template => template.isDefault) ?? all[0];
  }

  async create(userId: string, input: TemplateInput): Promise<OutreachTemplate> {
    this.validate(input);
    if (input.isDefault) await this.templates.updateAll({ isDefault: false }, { userId });
    const template = await this.templates.create({ userId, name: input.name.trim(), subject: input.subject.trim(), body: input.body, isDefault: input.isDefault ?? false });
    await this.audit.record({ userId, action: 'OUTREACH_TEMPLATE_CREATED', entity: 'OutreachTemplate', entityId: template.id });
    return template;
  }

  async update(userId: string, id: string, input: TemplateInput): Promise<OutreachTemplate> {
    await this.get(userId, id);
    this.validate(input);
    if (input.isDefault) await this.templates.updateAll({ isDefault: false }, { userId });
    await this.templates.updateById(id, { name: input.name.trim(), subject: input.subject.trim(), body: input.body, isDefault: input.isDefault ?? false });
    await this.audit.record({ userId, action: 'OUTREACH_TEMPLATE_UPDATED', entity: 'OutreachTemplate', entityId: id });
    return this.get(userId, id);
  }

  async delete(userId: string, id: string): Promise<void> {
    const template = await this.get(userId, id);
    if ((await this.templates.countOwned(userId)).count <= 1) {
      throw new AppBusinessError(ERROR_CODES.OUTREACH_TEMPLATE_LAST, 'Keep at least one template');
    }
    await this.templates.deleteById(id);
    if (template.isDefault) {
      const [next] = await this.templates.findOwned(userId, { order: ['createdAt ASC'], limit: 1 });
      if (next) await this.templates.updateById(next.id!, { isDefault: true });
    }
  }

  private validate(input: TemplateInput): void {
    const unknown = unknownPlaceholders(`${input.subject}\n${input.body}`);
    if (unknown.length > 0) {
      throw new AppValidationError(ERROR_CODES.TEMPLATE_INVALID, `Unknown placeholder(s): ${unknown.map(name => `{{${name}}}`).join(', ')}`);
    }
  }
}
