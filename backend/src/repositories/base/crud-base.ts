import { Count, DataObject, DefaultCrudRepository, Filter, Options, Where, juggler } from '@loopback/repository';
import { AppNotFoundError } from '../../common/errors';
import { OwnedEntity, TimestampedEntity } from '../../models';

type EntityClass<T extends TimestampedEntity> = typeof TimestampedEntity & { prototype: T };

/** Stamps createdAt/updatedAt on every write so services never have to. */
export class TimestampedRepository<T extends TimestampedEntity, Relations extends object = {}> extends DefaultCrudRepository<
  T,
  string,
  Relations
> {
  constructor(entityClass: EntityClass<T>, dataSource: juggler.DataSource) {
    super(entityClass, dataSource);
  }

  async create(entity: DataObject<T>, options?: Options): Promise<T> {
    const now = new Date();
    return super.create({ ...entity, createdAt: now, updatedAt: now } as DataObject<T>, options);
  }

  async createAll(entities: DataObject<T>[], options?: Options): Promise<T[]> {
    const now = new Date();
    return super.createAll(entities.map(entity => ({ ...entity, createdAt: now, updatedAt: now }) as DataObject<T>), options);
  }

  async updateById(id: string, data: DataObject<T>, options?: Options): Promise<void> {
    return super.updateById(id, { ...data, updatedAt: new Date() } as DataObject<T>, options);
  }

  async updateAll(data: DataObject<T>, where?: Where<T>, options?: Options): Promise<Count> {
    return super.updateAll({ ...data, updatedAt: new Date() } as DataObject<T>, where, options);
  }
}

/**
 * Repository for user-owned records. The `*Owned` helpers are the only reads
 * services use, so a record belonging to another user is indistinguishable from
 * one that does not exist.
 */
export class OwnedRepository<T extends OwnedEntity, Relations extends object = {}> extends TimestampedRepository<T, Relations> {
  ownedWhere(userId: string, where?: Where<T>): Where<T> {
    const owner = { userId } as Where<T>;
    return where ? ({ and: [owner, where] } as Where<T>) : owner;
  }

  findOwned(userId: string, filter: Filter<T> = {}): Promise<(T & Relations)[]> {
    return this.find({ ...filter, where: this.ownedWhere(userId, filter.where) });
  }

  countOwned(userId: string, where?: Where<T>): Promise<Count> {
    return this.count(this.ownedWhere(userId, where));
  }

  async findOwnedById(userId: string, id: string, filter: Filter<T> = {}, notFoundCode?: string): Promise<T & Relations> {
    const entity = await this.findOne({ ...filter, where: this.ownedWhere(userId, { id } as Where<T>) });
    if (!entity) throw new AppNotFoundError(notFoundCode, `${this.entityClass.modelName} not found`);
    return entity;
  }

  async deleteOwnedById(userId: string, id: string): Promise<void> {
    await this.findOwnedById(userId, id);
    await this.deleteById(id);
  }
}
