import { AuthenticationStrategy } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { Request } from '@loopback/rest';
import { securityId, UserProfile } from '@loopback/security';
import { AppAuthenticationError, ERROR_CODES } from '../common/errors';
import { JwtService } from '../services/auth/jwt.service';

export class JwtAuthenticationStrategy implements AuthenticationStrategy {
  name = 'jwt';

  constructor(@inject('services.JwtService') private jwtService: JwtService) {}

  async authenticate(request: Request): Promise<UserProfile> {
    const token = extractBearerToken(request.headers.authorization);
    const claims = this.jwtService.verify(token);
    return { [securityId]: claims.sub, id: claims.sub, email: claims.email, name: claims.name };
  }
}

export function extractBearerToken(header: string | undefined): string {
  if (!header) throw new AppAuthenticationError(ERROR_CODES.UNAUTHENTICATED, 'Authorization header is missing');
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AppAuthenticationError(ERROR_CODES.UNAUTHENTICATED, 'Authorization header must be "Bearer <token>"');
  }
  return token;
}

/** The authenticated caller's id. Controllers pass this to services; services never trust a client-supplied id. */
export function currentUserId(profile: UserProfile): string {
  return profile[securityId];
}
