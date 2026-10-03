import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { del, get, param, patch, post, put, requestBody, SchemaObject } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { PaginatedResult, parsePage } from '../../common/utils/list-query.util';
import { HiringPost, HiringPostStatus, RecruiterContact } from '../../models';
import { ContactInput, ContactService, ContactUpdate } from '../../services/outreach/contact.service';
import { HiringPostService, PostSourceView } from '../../services/outreach/hiring-post.service';

const ENABLED_BODY = {
  content: {
    'application/json': {
      schema: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } } as SchemaObject,
    },
  },
};

@authenticate('jwt')
export class HiringPostController {
  constructor(
    @inject('services.HiringPostService') private posts: HiringPostService,
    @inject('services.ContactService') private contacts: ContactService,
  ) {}

  /** The exact queries that will run, built from the profile's titles, location and template. */
  @get('/hiring-posts/queries')
  async queries(@inject(SecurityBindings.USER) profile: UserProfile): Promise<{ queries: string[] }> {
    return { queries: await this.posts.queries(currentUserId(profile)) };
  }

  @get('/hiring-posts/sources')
  sources(@inject(SecurityBindings.USER) profile: UserProfile): Promise<PostSourceView[]> {
    return this.posts.sources(currentUserId(profile));
  }

  @put('/hiring-posts/sources/{key}')
  setSource(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('key') key: string,
    @requestBody(ENABLED_BODY) body: { enabled: boolean },
  ): Promise<PostSourceView> {
    return this.posts.setSourceEnabled(currentUserId(profile), key, body.enabled);
  }

  @post('/hiring-posts/search')
  search(@inject(SecurityBindings.USER) profile: UserProfile): Promise<{ jobId: string; queries: string[] }> {
    return this.posts.requestSearch(currentUserId(profile));
  }

  @get('/hiring-posts')
  list(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.query.string('status') status?: HiringPostStatus,
    @param.query.string('q') search?: string,
    @param.query.number('page') page?: number,
    @param.query.number('limit') limit?: number,
  ): Promise<PaginatedResult<HiringPost>> {
    return this.posts.list(currentUserId(profile), { status, search }, parsePage(page, limit));
  }

  @patch('/hiring-posts/{id}')
  setStatus(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: Object.values(HiringPostStatus) } } },
        },
      },
    })
    body: { status: HiringPostStatus },
  ): Promise<HiringPost> {
    return this.posts.setStatus(currentUserId(profile), id, body.status);
  }

  @get('/contacts')
  listContacts(@inject(SecurityBindings.USER) profile: UserProfile): Promise<RecruiterContact[]> {
    return this.contacts.list(currentUserId(profile));
  }

  @post('/contacts')
  createContact(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email'],
            additionalProperties: false,
            properties: {
              email: { type: 'string', format: 'email', maxLength: 254 },
              name: { type: 'string', maxLength: 120 },
              company: { type: 'string', maxLength: 160 },
            },
          },
        },
      },
    })
    body: ContactInput,
  ): Promise<RecruiterContact> {
    return this.contacts.create(currentUserId(profile), body);
  }

  @patch('/contacts/{id}')
  updateContact(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', maxLength: 120, nullable: true },
              company: { type: 'string', maxLength: 160, nullable: true },
              doNotContact: { type: 'boolean' },
            },
          },
        },
      },
    })
    body: ContactUpdate,
  ): Promise<RecruiterContact> {
    return this.contacts.update(currentUserId(profile), id, body);
  }

  @del('/contacts/{id}')
  async deleteContact(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<void> {
    await this.contacts.delete(currentUserId(profile), id);
  }
}
