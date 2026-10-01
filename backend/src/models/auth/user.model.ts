import { model, property } from '@loopback/repository';
import { TimestampedEntity } from '../base/timestamped-entity.model';

@model({
  settings: {
    strict: true,
    hiddenProperties: ['passwordHash'],
    mongodb: { collection: 'users' },
    indexes: {
      uniqueEmail: { keys: { email: 1 }, options: { unique: true } },
    },
  },
})
export class User extends TimestampedEntity {
  /** Always stored lower-cased and trimmed. */
  @property({ type: 'string', required: true, jsonSchema: { format: 'email' } })
  email: string;

  @property({ type: 'string', required: true })
  name: string;

  @property({ type: 'string', required: true })
  passwordHash: string;

  @property({ type: 'date' })
  lastLoginAt?: Date;

  constructor(data?: Partial<User>) {
    super(data);
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id!, email: user.email, name: user.name };
}
