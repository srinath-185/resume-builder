import { AuthenticationStrategy } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { Request } from '@loopback/rest';
import { securityId, UserProfile } from '@loopback/security';
import { AppAuthenticationError, AppAuthorizationError, ERROR_CODES } from '../common/errors';
import { ADMIN_ROLES, roleOf, statusOf, tokenVersionOf, UserRole, UserStatus } from '../models';
import { UserRepository } from '../repositories';
import { JwtService } from '../services/auth/jwt.service';

/**
 * Verifies the bearer token, then re-reads the account so a deleted or
 * disabled user, a revoked session (tokenVersion) or a role change takes
 * effect on the next request instead of when the token expires.
 */
export class JwtAuthenticationStrategy implements AuthenticationStrategy {
  name = 'jwt';
  /** Roles allowed through; undefined means any signed-in user. */
  protected allowedRoles?: readonly UserRole[];

  constructor(
    @inject('services.JwtService') private jwtService: JwtService,
    @inject('repositories.UserRepository') private users: UserRepository,
  ) {}

  async authenticate(request: Request): Promise<UserProfile> {
    const token = extractBearerToken(request.headers.authorization);
    const claims = this.jwtService.verify(token);
    const user = await this.users.findById(claims.sub).catch(() => null);
    if (!user || tokenVersionOf(user) !== claims.tv) {
      throw new AppAuthenticationError(ERROR_CODES.TOKEN_INVALID, 'Session is invalid or expired');
    }
    if (statusOf(user) === UserStatus.DISABLED) {
      throw new AppAuthenticationError(ERROR_CODES.ACCOUNT_DISABLED, 'This account has been disabled');
    }
    // Checked here rather than in an interceptor so it runs before the request
    // body is parsed: a caller without the role learns nothing about the route.
    if (this.allowedRoles && !this.allowedRoles.includes(roleOf(user))) {
      throw new AppAuthorizationError(ERROR_CODES.FORBIDDEN, 'You do not have access to this');
    }
    return { [securityId]: user.id!, id: user.id, email: user.email, name: user.name, role: roleOf(user) };
  }
}

/** `@authenticate('jwt-admin')`: a signed-in admin or superadmin. */
export class AdminJwtAuthenticationStrategy extends JwtAuthenticationStrategy {
  name = 'jwt-admin';
  protected allowedRoles = ADMIN_ROLES;
}

/** `@authenticate('jwt-superadmin')`: a signed-in superadmin. */
export class SuperadminJwtAuthenticationStrategy extends JwtAuthenticationStrategy {
  name = 'jwt-superadmin';
  protected allowedRoles: readonly UserRole[] = [UserRole.SUPERADMIN];
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

/** The caller's role as read from the database on this request (never from the token). */
export function currentUserRole(profile: UserProfile): UserRole {
  return (profile.role as UserRole | undefined) ?? UserRole.USER;
}
