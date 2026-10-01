import { Entity, model, property } from '@loopback/repository';

/** Every persisted record carries an ObjectId and server-set timestamps. */
@model()
export class TimestampedEntity extends Entity {
  @property({ type: 'string', id: true, generated: true, mongodb: { dataType: 'ObjectId' } })
  id?: string;

  @property({ type: 'date' })
  createdAt?: Date;

  @property({ type: 'date' })
  updatedAt?: Date;

  constructor(data?: Partial<TimestampedEntity>) {
    super(data);
  }
}

/** A record that belongs to exactly one user. Reads and writes are always filtered by `userId`. */
@model()
export class OwnedEntity extends TimestampedEntity {
  @property({ type: 'string', required: true, mongodb: { dataType: 'ObjectId' } })
  userId: string;

  constructor(data?: Partial<OwnedEntity>) {
    super(data);
  }
}
