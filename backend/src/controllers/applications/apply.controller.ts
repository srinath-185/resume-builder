import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { del, get, param, post, put, requestBody, Response, RestBindings } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { sendFile } from '../../common/utils/send-file.util';
import { JobApplication, PortalSession } from '../../models';
import { ApplyAgentService } from '../../services/apply/apply-agent.service';
import { PortalSessionInput, PortalSessionService } from '../../services/apply/portal-session.service';

@authenticate('jwt')
export class ApplyController {
  constructor(
    @inject('services.ApplyAgentService') private agent: ApplyAgentService,
    @inject('services.PortalSessionService') private sessions: PortalSessionService,
  ) {}

  /** Start the assisted apply for an approved application (also used to retry after NEEDS_REVIEW/FAILED). */
  @post('/applications/{id}/apply')
  apply(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<JobApplication> {
    return this.agent.requestApply(currentUserId(profile), id);
  }

  @get('/applications/{id}/screenshot.png')
  async screenshot(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @inject(RestBindings.Http.RESPONSE) response: Response,
  ): Promise<Response> {
    return sendFile(response, await this.agent.screenshotOf(currentUserId(profile), id), 'image/png', 'application.png', true);
  }

  @get('/portal-sessions')
  listSessions(@inject(SecurityBindings.USER) profile: UserProfile): Promise<PortalSession[]> {
    return this.sessions.list(currentUserId(profile));
  }

  @put('/portal-sessions/{portal}')
  saveSession(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('portal') portal: string,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              liAt: { type: 'string', minLength: 10, maxLength: 2000 },
              cookies: {
                type: 'array',
                maxItems: 50,
                items: {
                  type: 'object',
                  required: ['name', 'value'],
                  properties: {
                    name: { type: 'string', maxLength: 200 },
                    value: { type: 'string', maxLength: 4000 },
                    domain: { type: 'string', maxLength: 200 },
                    path: { type: 'string', maxLength: 200 },
                    secure: { type: 'boolean' },
                    httpOnly: { type: 'boolean' },
                    expires: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    })
    body: PortalSessionInput,
  ): Promise<PortalSession> {
    return this.sessions.save(currentUserId(profile), portal, body);
  }

  @del('/portal-sessions/{portal}')
  async deleteSession(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('portal') portal: string): Promise<void> {
    await this.sessions.delete(currentUserId(profile), portal);
  }
}
