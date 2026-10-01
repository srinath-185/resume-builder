import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { del, get, param, post, put, requestBody, SchemaObject } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { OutreachMessage, OutreachStatus, OutreachTemplate } from '../../models';
import { OutreachTemplateService, TemplateInput } from '../../services/outreach/outreach-template.service';
import { DraftInput, OutreachService } from '../../services/outreach/outreach.service';

const TEMPLATE_BODY: SchemaObject = {
  type: 'object',
  required: ['name', 'subject', 'body'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    subject: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', minLength: 1, maxLength: 4000 },
    isDefault: { type: 'boolean' },
  },
};

@authenticate('jwt')
export class OutreachController {
  constructor(
    @inject('services.OutreachService') private outreach: OutreachService,
    @inject('services.OutreachTemplateService') private templates: OutreachTemplateService,
  ) {}

  @get('/outreach-templates')
  listTemplates(@inject(SecurityBindings.USER) profile: UserProfile): Promise<OutreachTemplate[]> {
    return this.templates.list(currentUserId(profile));
  }

  @post('/outreach-templates')
  createTemplate(@inject(SecurityBindings.USER) profile: UserProfile, @requestBody({ content: { 'application/json': { schema: TEMPLATE_BODY } } }) body: TemplateInput): Promise<OutreachTemplate> {
    return this.templates.create(currentUserId(profile), body);
  }

  @put('/outreach-templates/{id}')
  updateTemplate(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({ content: { 'application/json': { schema: TEMPLATE_BODY } } }) body: TemplateInput,
  ): Promise<OutreachTemplate> {
    return this.templates.update(currentUserId(profile), id, body);
  }

  @del('/outreach-templates/{id}')
  async deleteTemplate(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<void> {
    await this.templates.delete(currentUserId(profile), id);
  }

  /** Draft an email for an approved application. Nothing is sent until POST /outreach/{id}/send. */
  @post('/outreach')
  draft(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['applicationId'],
            additionalProperties: false,
            properties: {
              applicationId: { type: 'string', maxLength: 40 },
              contactId: { type: 'string', maxLength: 40 },
              email: { type: 'string', format: 'email', maxLength: 254 },
              name: { type: 'string', maxLength: 120 },
              hiringPostId: { type: 'string', maxLength: 40 },
              templateId: { type: 'string', maxLength: 40 },
              personalise: { type: 'boolean' },
            },
          },
        },
      },
    })
    body: DraftInput,
  ): Promise<OutreachMessage> {
    return this.outreach.draft(currentUserId(profile), body);
  }

  @get('/outreach')
  list(@inject(SecurityBindings.USER) profile: UserProfile, @param.query.string('status') status?: OutreachStatus): Promise<OutreachMessage[]> {
    return this.outreach.list(currentUserId(profile), status);
  }

  @get('/outreach/{id}')
  get(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<OutreachMessage> {
    return this.outreach.get(currentUserId(profile), id);
  }

  @put('/outreach/{id}')
  update(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: false, properties: { subject: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', minLength: 1, maxLength: 6000 } } },
        },
      },
    })
    body: { subject?: string; body?: string },
  ): Promise<OutreachMessage> {
    return this.outreach.update(currentUserId(profile), id, body);
  }

  @post('/outreach/{id}/send')
  send(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<OutreachMessage> {
    return this.outreach.send(currentUserId(profile), id);
  }

  @post('/outreach/{id}/cancel')
  cancel(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<OutreachMessage> {
    return this.outreach.cancel(currentUserId(profile), id);
  }
}
