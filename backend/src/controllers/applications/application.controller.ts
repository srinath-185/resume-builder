import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get, param, post, put, requestBody, Response, RestBindings, SchemaObject } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { sendFile } from '../../common/utils/send-file.util';
import { ApplicationStatus } from '../../domain/application-status';
import { JobApplication } from '../../models';
import { ApplyAgentService } from '../../services/apply/apply-agent.service';
import { ApplicationReview, ApplicationService, VariantEdit } from '../../services/tailoring/application.service';

const INSTRUCTIONS_BODY = {
  content: {
    'application/json': {
      schema: { type: 'object', additionalProperties: false, properties: { instructions: { type: 'string', maxLength: 1000 } } } as SchemaObject,
    },
  },
  required: false,
};

@authenticate('jwt')
export class ApplicationController {
  constructor(
    @inject('services.ApplicationService') private applications: ApplicationService,
    @inject('services.ApplyAgentService') private applyAgent: ApplyAgentService,
  ) {}

  /** Draft a resume tailored to this job. Returns the application in TAILORING; the draft arrives for review. */
  @post('/jobs/{id}/tailor')
  tailor(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') listingId: string,
    @requestBody(INSTRUCTIONS_BODY) body?: { instructions?: string },
  ): Promise<JobApplication> {
    return this.applications.requestTailor(currentUserId(profile), listingId, { instructions: body?.instructions });
  }

  @get('/applications')
  list(@inject(SecurityBindings.USER) profile: UserProfile, @param.query.string('status') status?: ApplicationStatus): Promise<JobApplication[]> {
    return this.applications.list(currentUserId(profile), status);
  }

  /** Everything the review screen needs: job, master resume, tailored variant, diff, coverage, fact-check. */
  @get('/applications/{id}')
  review(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<ApplicationReview> {
    return this.applications.review(currentUserId(profile), id);
  }

  @put('/applications/{id}/variant')
  editVariant(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              document: { type: 'object' },
              coverNote: { type: 'string', maxLength: 3000 },
              formAnswers: {
                type: 'array',
                maxItems: 10,
                items: {
                  type: 'object',
                  required: ['question', 'answer'],
                  additionalProperties: false,
                  properties: { question: { type: 'string', maxLength: 300 }, answer: { type: 'string', maxLength: 2000 } },
                },
              },
            },
          },
        },
      },
    })
    body: VariantEdit,
  ): Promise<ApplicationReview> {
    return this.applications.editVariant(currentUserId(profile), id, body);
  }

  /** Approve the tailored resume. If the profile opted into auto-apply, the assisted apply starts next. */
  @post('/applications/{id}/approve')
  async approve(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<JobApplication> {
    const userId = currentUserId(profile);
    const approved = await this.applications.approve(userId, id);
    await this.applyAgent.applyIfAutoEnabled(userId, id);
    return this.applications.get(userId, approved.id!);
  }

  @post('/applications/{id}/reject')
  reject(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { reason: { type: 'string', maxLength: 500 } } } } },
      required: false,
    })
    body?: { reason?: string },
  ): Promise<JobApplication> {
    return this.applications.reject(currentUserId(profile), id, body?.reason);
  }

  @post('/applications/{id}/regenerate')
  regenerate(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody(INSTRUCTIONS_BODY) body?: { instructions?: string },
  ): Promise<JobApplication> {
    return this.applications.regenerate(currentUserId(profile), id, body?.instructions);
  }

  @post('/applications/{id}/mark-applied')
  markApplied(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<JobApplication> {
    return this.applications.markApplied(currentUserId(profile), id);
  }

  /** The tailored PDF: the approved one when approved, else the draft under review. */
  @get('/applications/{id}/resume.pdf')
  async pdf(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @inject(RestBindings.Http.RESPONSE) response: Response,
  ): Promise<Response> {
    const file = await this.applications.variantPdf(currentUserId(profile), id);
    return sendFile(response, file.data, 'application/pdf', file.fileName, true);
  }
}
