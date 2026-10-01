import { BindingScope, injectable } from '@loopback/core';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AppConfigurationError } from '../../common/errors';
import { envString } from '../../common/config/env.util';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = 'v1';

/**
 * Authenticated encryption for secrets stored at rest: OAuth refresh tokens,
 * portal session cookies, user-supplied API keys. Output format is
 * `v1:<iv>:<tag>:<ciphertext>` (base64 parts) so the scheme can be rotated later.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class EncryptionService {
  private key(): Buffer {
    const hex = envString('ENCRYPTION_KEY');
    if (!hex) throw new AppConfigurationError('ENCRYPTION_KEY is not configured');
    const key = Buffer.from(hex, 'hex');
    if (key.length !== KEY_BYTES) {
      throw new AppConfigurationError(`ENCRYPTION_KEY must be ${KEY_BYTES} bytes of hex`);
    }
    return key;
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key(), iv);
    const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), cipherText.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, cipherText] = payload.split(':');
    if (version !== VERSION || !iv || !tag || cipherText === undefined) {
      throw new AppConfigurationError('Encrypted value has an unknown format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(cipherText, 'base64')), decipher.final()]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(payload: string): T {
    return JSON.parse(this.decrypt(payload)) as T;
  }
}
