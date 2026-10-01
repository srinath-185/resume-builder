import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get, post, requestBody, SchemaObject } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { PublicUser } from '../../models';
import { AuthResult, AuthService, LoginInput, MIN_PASSWORD_LENGTH, RegisterInput } from '../../services/auth/auth.service';

const EMAIL: SchemaObject = { type: 'string', format: 'email', maxLength: 254 };

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
              password: { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 },
              name: { type: 'string', minLength: 1, maxLength: 120 },
            },
          },
        },
      },
    })
    body: RegisterInput,
  ): Promise<AuthResult> {
    return this.authService.register(body);
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
  ): Promise<AuthResult> {
    return this.authService.login(body);
  }

  @authenticate('jwt')
  @get('/auth/me')
  me(@inject(SecurityBindings.USER) profile: UserProfile): Promise<PublicUser> {
    return this.authService.me(currentUserId(profile));
  }
}
