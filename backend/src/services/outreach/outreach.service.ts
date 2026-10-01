import { BindingScope, inject, injectable } from '@loopback/core';
import { envInt } from '../../common/config/env.util';
import { AppBusinessError, AppError, ERROR_CODES } from '../../common/errors';
import { numbersIn } from '../../domain/resume-fact-check';
import { FOLLOW_UP_BODY, OPT_OUT_LINE, renderTemplate, TemplateValues } from '../../domain/template-render';
import { ContactSource, HiringPostStatus, OutreachMessage, OutreachStatus } from '../../models';
import { QueueService } from '../../queue/queue.service';
import { HiringPostRepository, OutreachMessageRepository, RecruiterContactRepository, UserRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { LoggerService } from '../common/logger.service';
import { LlmRouterService } from '../llm/llm-router.service';
import { LlmTask } from '../llm/llm.types';
import { MailConnectorService } from '../mail/mail-connector.service';
import { CandidateProfileService } from '../resume/candidate-profile.service';
import { ApplicationService } from '../tailoring/application.service';
import { ContactService } from './contact.service';
import { OutreachTemplateService } from './outreach-template.service';
import { OUTREACH_PERSONALISE_SYSTEM, PersonalisedSchema, personaliseUserMessage } from './prompts/outreach.prompt';

export const OUTREACH_SEND_QUEUE = 'outreach-send';

export interface OutreachSendJob {
  userId: string;
  messageId: string;
}

export interface DraftInput {
  applicationId: string;
  contactId?: string;
  email?: string;
  name?: string;
  hiringPostId?: string;
  templateId?: string;
  personalise?: boolean;
}

function startOfUtcDay(now = new Date()): Date {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * Recruiter emails. A draft can only be created for an application whose
 * tailored resume the user approved, and the approved PDF is re-fetched at
 * send time through the same gate. Every send is user-initiated, capped per
 * day, refused for do-not-contact recipients and de-duplicated per job.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class OutreachService {
  constructor(
    @inject('repositories.OutreachMessageRepository') private messages: OutreachMessageRepository,
    @inject('repositories.RecruiterContactRepository') private contactRepo: RecruiterContactRepository,
    @inject('repositories.HiringPostRepository') private posts: HiringPostRepository,
    @inject('repositories.UserRepository') private users: UserRepository,
    @inject('services.ContactService') private contacts: ContactService,
    @inject('services.OutreachTemplateService') private templates: OutreachTemplateService,
    @inject('services.ApplicationService') private applications: ApplicationService,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
    @inject('services.MailConnectorService') private mail: MailConnectorService,
    @inject('services.LlmRouterService') private llm: LlmRouterService,
    @inject('services.QueueService') private queue: QueueService,
    @inject('services.AuditService') private audit: AuditService,
    @inject('services.LoggerService') private logger: LoggerService,
  ) {}

  list(userId: string, status?: OutreachStatus): Promise<OutreachMessage[]> {
    const where = status && Object.values(OutreachStatus).includes(status) ? { status } : undefined;
    return this.messages.findOwned(userId, { where, order: ['createdAt DESC'], limit: 200 });
  }

  get(userId: string, id: string): Promise<OutreachMessage> {
    return this.messages.findOwnedById(userId, id, {}, ERROR_CODES.OUTREACH_NOT_FOUND);
  }

  async draft(userId: string, input: DraftInput): Promise<OutreachMessage> {
    const materials = await this.applications.approvedMaterials(userId, input.applicationId);
    const contact = await this.resolveContact(userId, input);
    if (contact.doNotContact) throw new AppBusinessError(ERROR_CODES.CONTACT_DO_NOT_CONTACT, 'This person asked not to be contacted');
    const post = input.hiringPostId ? await this.posts.findOwnedById(userId, input.hiringPostId, {}, ERROR_CODES.HIRING_POST_NOT_FOUND) : undefined;
    const template = input.templateId ? await this.templates.get(userId, input.templateId) : await this.templates.defaultFor(userId);

    const values = await this.values(userId, { recruiterName: contact.name, company: contact.company ?? materials.listing.company, jobTitle: materials.listing.title, coverNote: materials.coverNote, postUrl: post?.postUrl });
    let subject = renderTemplate(template.subject, values);
    let body = `${renderTemplate(template.body, values)}\n\n${OPT_OUT_LINE}`;
    if (input.personalise) ({ subject, body } = await this.personalise(userId, { subject, body }, post?.text));

    const message = await this.messages.create({
      userId,
      contactId: contact.id!,
      toEmail: contact.email,
      applicationId: input.applicationId,
      hiringPostId: post?.id,
      templateId: template.id,
      subject,
      body,
      attachmentName: materials.fileName,
      status: OutreachStatus.DRAFT,
      sequence: 1,
      followUpCreated: false,
    });
    await this.audit.record({ userId, action: 'OUTREACH_DRAFTED', entity: 'OutreachMessage', entityId: message.id, meta: { to: contact.email, applicationId: input.applicationId } });
    return message;
  }

  async update(userId: string, id: string, edit: { subject?: string; body?: string }): Promise<OutreachMessage> {
    const message = await this.get(userId, id);
    if (message.status !== OutreachStatus.DRAFT) throw new AppBusinessError(ERROR_CODES.OUTREACH_NOT_EDITABLE, 'Only drafts can be edited');
    await this.messages.updateById(id, { ...(edit.subject !== undefined ? { subject: edit.subject } : {}), ...(edit.body !== undefined ? { body: edit.body } : {}) });
    return this.get(userId, id);
  }

  /** The user pressed Send. Checks happen here and again in the worker. */
  async send(userId: string, id: string): Promise<OutreachMessage> {
    const message = await this.get(userId, id);
    if (message.status !== OutreachStatus.DRAFT && message.status !== OutreachStatus.FAILED) {
      throw new AppBusinessError(ERROR_CODES.OUTREACH_NOT_EDITABLE, `A ${message.status.toLowerCase()} email cannot be sent again`);
    }
    await this.preflight(userId, message);
    const result = await this.messages.updateAll({ status: OutreachStatus.QUEUED, error: undefined }, { id, userId, status: message.status });
    if (result.count !== 1) throw new AppBusinessError(ERROR_CODES.APPLICATION_CHANGED, 'This email changed meanwhile; reload and try again');
    await this.queue.enqueue<OutreachSendJob>(OUTREACH_SEND_QUEUE, { userId, messageId: id }, { jobId: `outreach-${id}-${Date.now()}` });
    return this.get(userId, id);
  }

  async cancel(userId: string, id: string): Promise<OutreachMessage> {
    const message = await this.get(userId, id);
    if (message.status !== OutreachStatus.DRAFT && message.status !== OutreachStatus.QUEUED) {
      throw new AppBusinessError(ERROR_CODES.OUTREACH_NOT_EDITABLE, 'Only drafts or queued emails can be cancelled');
    }
    await this.messages.updateById(id, { status: OutreachStatus.CANCELLED });
    return this.get(userId, id);
  }

  /** Worker side of send(). Never throws: the outcome is stored on the message. */
  async deliver({ userId, messageId }: OutreachSendJob): Promise<void> {
    const message = await this.messages.findOwnedById(userId, messageId);
    if (message.status !== OutreachStatus.QUEUED) return;
    try {
      await this.preflight(userId, message);
      const materials = await this.applications.approvedMaterials(userId, message.applicationId);
      const parent = message.followUpOf ? await this.messages.findById(message.followUpOf).catch(() => undefined) : undefined;
      const sent = await this.mail.send(userId, {
        to: message.toEmail,
        subject: message.subject,
        text: message.body,
        attachments: message.sequence === 1 ? [{ filename: materials.fileName, content: materials.pdf, contentType: 'application/pdf' }] : [],
        inReplyTo: parent?.messageId,
        threadId: parent?.threadId,
      });
      const sentAt = new Date();
      await this.messages.updateById(messageId, {
        status: OutreachStatus.SENT,
        sentAt,
        messageId: sent.messageId,
        threadId: sent.threadId,
        provider: sent.provider,
        followUpDueAt: message.sequence === 1 ? new Date(sentAt.getTime() + envInt('OUTREACH_FOLLOWUP_DAYS', 5) * 86_400_000) : undefined,
      });
      await this.contacts.markContacted(message.contactId);
      if (message.hiringPostId) await this.posts.updateById(message.hiringPostId, { status: HiringPostStatus.CONTACTED });
      await this.audit.record({ userId, action: 'OUTREACH_SENT', entity: 'OutreachMessage', entityId: messageId, meta: { to: message.toEmail, provider: sent.provider, sequence: message.sequence } });
    } catch (error) {
      const reason = error instanceof AppError ? `${error.code}: ${error.message}` : 'Sending failed';
      this.logger.warn('Outreach send failed', { messageId, error: (error as Error).message });
      await this.messages.updateById(messageId, { status: OutreachStatus.FAILED, error: reason });
    }
  }

  /** Daily: drafts (never sends) one follow-up per first email that got no follow-up yet. */
  async createDueFollowUps(now = new Date()): Promise<number> {
    const due = await this.messages.find({ where: { status: OutreachStatus.SENT, sequence: 1, followUpCreated: false, followUpDueAt: { lte: now } }, limit: 500 });
    let created = 0;
    for (const original of due) {
      await this.messages.updateById(original.id!, { followUpCreated: true });
      const contact = await this.contactRepo.findById(original.contactId).catch(() => undefined);
      if (!contact || contact.doNotContact) continue;
      const materials = await this.applications.approvedMaterials(original.userId, original.applicationId).catch(() => undefined);
      if (!materials) continue;
      const values = await this.values(original.userId, { recruiterName: contact.name, company: contact.company ?? materials.listing.company, jobTitle: materials.listing.title });
      await this.messages.create({
        userId: original.userId,
        contactId: original.contactId,
        toEmail: original.toEmail,
        applicationId: original.applicationId,
        hiringPostId: original.hiringPostId,
        subject: original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`,
        body: `${renderTemplate(FOLLOW_UP_BODY, values)}\n\n${OPT_OUT_LINE}`,
        status: OutreachStatus.DRAFT,
        sequence: 2,
        followUpOf: original.id,
        followUpCreated: true,
      });
      created++;
    }
    return created;
  }

  private async preflight(userId: string, message: OutreachMessage): Promise<void> {
    const contact = await this.contactRepo.findOwnedById(userId, message.contactId, {}, ERROR_CODES.CONTACT_NOT_FOUND);
    if (contact.doNotContact) throw new AppBusinessError(ERROR_CODES.CONTACT_DO_NOT_CONTACT, 'This person asked not to be contacted');
    const cap = (await this.profiles.get(userId)).dailyCaps.outreach;
    const sentToday = (await this.messages.countOwned(userId, { status: OutreachStatus.SENT, sentAt: { gte: startOfUtcDay() } })).count;
    if (sentToday >= cap) throw new AppBusinessError(ERROR_CODES.OUTREACH_DAILY_CAP_REACHED, `Daily limit of ${cap} emails reached; it resets at 00:00 UTC`);
    if (message.sequence === 1) {
      const duplicate = await this.messages.findOne({
        where: { userId, contactId: message.contactId, applicationId: message.applicationId, sequence: 1, status: { inq: [OutreachStatus.SENT, OutreachStatus.QUEUED] }, id: { neq: message.id } },
      });
      if (duplicate) throw new AppBusinessError(ERROR_CODES.OUTREACH_DUPLICATE, 'You already emailed this person about this job');
    }
  }

  private async resolveContact(userId: string, input: DraftInput) {
    if (input.contactId) return this.contactRepo.findOwnedById(userId, input.contactId, {}, ERROR_CODES.CONTACT_NOT_FOUND);
    if (!input.email) throw new AppBusinessError(ERROR_CODES.VALIDATION_ERROR, 'Choose a contact or enter an email address');
    const email = input.email.trim().toLowerCase();
    const existing = await this.contactRepo.findOne({ where: { userId, email } });
    if (existing) return existing;
    return this.contactRepo.create({ userId, email, name: input.name?.trim() || undefined, source: ContactSource.MANUAL, doNotContact: false });
  }

  private async values(userId: string, partial: TemplateValues): Promise<TemplateValues> {
    const [user, sender] = await Promise.all([this.users.findById(userId), this.mail.senderOf(userId)]);
    return { candidateName: user.name, senderName: sender?.senderName || user.name, ...partial };
  }

  /** Optional model rewrite; falls back to the template text if it adds any number or fails. */
  private async personalise(userId: string, draft: { subject: string; body: string }, postText?: string): Promise<{ subject: string; body: string }> {
    try {
      const { value } = await this.llm.completeJson(
        { task: LlmTask.OUTREACH_DRAFT, system: OUTREACH_PERSONALISE_SYSTEM, messages: [{ role: 'user', content: personaliseUserMessage(draft, postText) }], userId },
        PersonalisedSchema,
      );
      const allowed = numbersIn(`${draft.subject}\n${draft.body}\n${postText ?? ''}`);
      const invented = [...numbersIn(`${value.subject}\n${value.body}`)].filter(number => !allowed.has(number));
      if (invented.length > 0) return draft;
      const body = value.body.includes(OPT_OUT_LINE) ? value.body : `${value.body}\n\n${OPT_OUT_LINE}`;
      return { subject: value.subject, body };
    } catch (error) {
      this.logger.warn('Outreach personalisation skipped', { error: (error as Error).message });
      return draft;
    }
  }
}
