import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get, post, Request, requestBody, RestBindings, SchemaObject } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { PublicUser } from '../../models';
import { AuthResult, AuthService, LoginInput, MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, RegisterInput } from '../../services/auth/auth.service';

const EMAIL: SchemaObject = { type: 'string', format: 'email', maxLength: 254 };

/** The caller's address. Honours X-Forwarded-For only when TRUST_PROXY is configured. */
export function clientIp(request: Request): string {
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}

export class AuthController {
  constructor(@inject('services.AuthService') private authService: AuthService) {}

  @post('/auth/register')
  register(
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'password', 'name'],
            additionalProperties: false,
            properties: {
              email: EMAIL,
              password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_BYTES },
              name: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
    })
    body: RegisterInput,
    @inject(RestBindings.Http.REQUEST) request: Request,
  ): Promise<AuthResult> {
    return this.authService.register(body, clientIp(request));
  }

  @post('/auth/login')
  login(
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'password'],
            additionalProperties: false,
            properties: { email: EMAIL, password: { type: 'string', minLength: 1, maxLength: 200 } },
          },
        },
      },
    })
    body: LoginInput,
    @inject(RestBindings.Http.REQUEST) request: Request,
  ): Promise<AuthResult> {
    return this.authService.login(body, clientIp(request));
  }

  @authenticate('jwt')
  @get('/auth/me')
  me(@inject(SecurityBindings.USER) profile: UserProfile): Promise<PublicUser> {
    return this.authService.me(currentUserId(profile));
  }

  /** Revokes every session of the caller, including this one. */
  @authenticate('jwt')
  @post('/auth/sign-out-everywhere')
  async signOutEverywhere(@inject(SecurityBindings.USER) profile: UserProfile): Promise<void> {
    await this.authService.signOutEverywhere(currentUserId(profile));
  }
}
