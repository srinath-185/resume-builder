import { BindingScope, inject, injectable } from '@loopback/core';
import { AppNotFoundError, ERROR_CODES } from '../../common/errors';
import { JobSourceSetting } from '../../models';
import { JobSourceSettingRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';
import { ConnectorRegistryService } from './connector-registry.service';
import { ConnectorInfo } from './connectors/job-source.connector';

export interface JobSourceView extends ConnectorInfo {
  configured: boolean;
  enabled: boolean;
  lastRunAt?: Date;
  lastFound?: number;
  lastError?: string;
}

/** Unofficial scrapers start disabled; the user opts in knowingly. */
function enabledByDefault(info: ConnectorInfo): boolean {
  return info.official;
}

@injectable({ scope: BindingScope.TRANSIENT })
export class JobSourceService {
  constructor(
    @inject('services.ConnectorRegistryService') private registry: ConnectorRegistryService,
    @inject('repositories.JobSourceSettingRepository') private settings: JobSourceSettingRepository,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  async list(userId: string): Promise<JobSourceView[]> {
    const saved = new Map((await this.settings.findOwned(userId)).map(setting => [setting.connectorKey, setting]));
    return this.registry.all().map(connector => {
      const setting = saved.get(connector.info.key);
      return {
        ...connector.info,
        configured: connector.isConfigured(),
        enabled: setting?.enabled ?? enabledByDefault(connector.info),
        lastRunAt: setting?.lastRunAt,
        lastFound: setting?.lastFound,
        lastError: setting?.lastError,
      };
    });
  }

  async setEnabled(userId: string, key: string, enabled: boolean): Promise<JobSourceView> {
    if (!this.registry.isKnown(key)) throw new AppNotFoundError(ERROR_CODES.JOB_SOURCE_UNKNOWN, `Unknown job source "${key}"`);
    const setting = await this.upsert(userId, key, { enabled });
    await this.audit.record({ userId, action: enabled ? 'JOB_SOURCE_ENABLED' : 'JOB_SOURCE_DISABLED', entity: 'JobSourceSetting', entityId: setting.id });
    return (await this.list(userId)).find(view => view.key === key)!;
  }

  /** Connectors that are configured on the server and enabled for this user. */
  async active(userId: string) {
    const views = await this.list(userId);
    const keys = new Set(views.filter(view => view.configured && view.enabled).map(view => view.key));
    return this.registry.all().filter(connector => keys.has(connector.info.key));
  }

  async recordRun(userId: string, key: string, result: { found?: number; error?: string }): Promise<void> {
    await this.upsert(userId, key, { lastRunAt: new Date(), lastFound: result.found, lastError: result.error });
  }

  private async upsert(userId: string, connectorKey: string, data: Partial<JobSourceSetting>): Promise<JobSourceSetting> {
    const existing = await this.settings.findOne({ where: { userId, connectorKey } });
    if (existing) {
      await this.settings.updateById(existing.id!, data);
      return this.settings.findById(existing.id!);
    }
    const connector = this.registry.get(connectorKey)!;
    return this.settings.create({ userId, connectorKey, enabled: enabledByDefault(connector.info), ...data });
  }
}
