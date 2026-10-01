import { BindingScope, injectable } from '@loopback/core';
import jwt from 'jsonwebtoken';
import { envString, requiredEnv } from '../../common/config/env.util';
import { AppAuthenticationError, ERROR_CODES } from '../../common/errors';
import { isAdminRole, PublicUser } from '../../models';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
  /** The user's tokenVersion when this token was issued; a mismatch means it was revoked. */
  tv: number;
}

const ISSUER = 'resume-builder';

@injectable({ scope: BindingScope.SINGLETON })
export class JwtService {
  sign(user: PublicUser, tokenVersion: number): string {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email, name: user.name, tv: tokenVersion };
    // Admin sessions are short-lived: a stolen admin token is worth far more.
    const expiresIn = isAdminRole(user.role) ? envString('JWT_ADMIN_EXPIRES_IN', '1h') : envString('JWT_EXPIRES_IN', '12h');
    return jwt.sign(claims, requiredEnv('JWT_SECRET'), {
      algorithm: 'HS256',
      issuer: ISSUER,
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  verify(token: string): AccessTokenClaims {
    try {
      const decoded = jwt.verify(token, requiredEnv('JWT_SECRET'), { algorithms: ['HS256'], issuer: ISSUER });
      if (typeof decoded === 'string' || !decoded.sub) throw new Error('Unexpected token payload');
      return { sub: String(decoded.sub), email: String(decoded.email), name: String(decoded.name), tv: Number(decoded.tv ?? 0) };
    } catch {
      throw new AppAuthenticationError(ERROR_CODES.TOKEN_INVALID, 'Session is invalid or expired');
    }
  }
}
