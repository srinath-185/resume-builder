import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { del, get, param, post, put, requestBody, Response, RestBindings } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { envString } from '../../common/config/env.util';
import { MailConnectorService, MailConnectorView, SmtpInput } from '../../services/mail/mail-connector.service';

function frontendUrl(path: string): string {
  return `${(envString('FRONTEND_URL', 'http://localhost:5300') ?? '').replace(/\/+$/, '')}${path}`;
}

export class MailController {
  constructor(@inject('services.MailConnectorService') private mail: MailConnectorService) {}

  @authenticate('jwt')
  @get('/mail-connector')
  view(@inject(SecurityBindings.USER) profile: UserProfile): Promise<MailConnectorView> {
    return this.mail.view(currentUserId(profile));
  }

  /** Returns the Google consent URL; the browser goes there and comes back to the callback. */
  @authenticate('jwt')
  @post('/mail-connector/gmail/start')
  startGmail(@inject(SecurityBindings.USER) profile: UserProfile): { url: string } {
    return this.mail.startGmail(currentUserId(profile));
  }

  /**
   * Google redirects here. Unauthenticated by design: the signed `state` says
   * who started the sign-in. The grant is handed to the app as an encrypted
   * pending token, which the app confirms with the user's session below.
   */
  @get('/mail-connector/gmail/callback')
  async gmailCallback(
    @param.query.string('code') code: string | undefined,
    @param.query.string('state') state: string | undefined,
    @param.query.string('error') error: string | undefined,
    @inject(RestBindings.Http.RESPONSE) response: Response,
  ): Promise<Response> {
    let target = '/settings/mail?gmail=cancelled';
    if (!error && code && state) {
      try {
        const pending = await this.mail.completeGmail(code, state);
        target = `/settings/mail?gmail=confirm&pending=${encodeURIComponent(pending)}`;
      } catch {
        target = '/settings/mail?gmail=error';
      }
    }
    response.redirect(frontendUrl(target));
    return response;
  }

  @authenticate('jwt')
  @post('/mail-connector/gmail/confirm')
  confirmGmail(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @requestBody({
      content: {
        'application/json': {
          schema: { type: 'object', required: ['pending'], additionalProperties: false, properties: { pending: { type: 'string', minLength: 1, maxLength: 4096 } } },
        },
      },
    })
    body: { pending: string },
  ): Promise<MailConnectorView> {
    return this.mail.confirmGmail(currentUserId(profile), body.pending);
  }

  @authenticate('jwt')
  @put('/mail-connector/smtp')
  saveSmtp(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['host', 'port', 'secure', 'user', 'pass', 'senderEmail'],
            additionalProperties: false,
            properties: {
              host: { type: 'string', minLength: 3, maxLength: 200 },
              port: { type: 'integer', minimum: 1, maximum: 65535 },
              secure: { type: 'boolean' },
              user: { type: 'string', minLength: 1, maxLength: 200 },
              pass: { type: 'string', minLength: 1, maxLength: 500 },
              senderEmail: { type: 'string', format: 'email', maxLength: 254 },
              senderName: { type: 'string', maxLength: 120 },
            },
          },
        },
      },
    })
    body: SmtpInput,
  ): Promise<MailConnectorView> {
    return this.mail.saveSmtp(currentUserId(profile), body);
  }

  @authenticate('jwt')
  @post('/mail-connector/test')
  async test(@inject(SecurityBindings.USER) profile: UserProfile): Promise<{ sent: true }> {
    await this.mail.sendTest(currentUserId(profile));
    return { sent: true };
  }

  @authenticate('jwt')
  @del('/mail-connector')
  async disconnect(@inject(SecurityBindings.USER) profile: UserProfile): Promise<void> {
    await this.mail.disconnect(currentUserId(profile));
  }
}
