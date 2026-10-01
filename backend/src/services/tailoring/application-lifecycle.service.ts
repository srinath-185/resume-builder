import { BindingScope, inject, injectable } from '@loopback/core';
import { DataObject } from '@loopback/repository';
import { AppBusinessError, AppConflictError, ERROR_CODES } from '../../common/errors';
import { ApplicationStatus, canTransition } from '../../domain/application-status';
import { JobApplication } from '../../models';
import { JobApplicationRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';

/**
 * The single place an application changes status. Every move is checked
 * against the transition table and applied with a compare-and-set on the
 * current status, so two concurrent requests (e.g. a double-clicked Approve)
 * cannot both succeed.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class ApplicationLifecycleService {
  constructor(
    @inject('repositories.JobApplicationRepository') private applications: JobApplicationRepository,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  async transition(
    application: JobApplication,
    to: ApplicationStatus,
    options: { note?: string; data?: DataObject<JobApplication>; actor?: 'user' | 'system' } = {},
  ): Promise<JobApplication> {
    const from = application.status;
    if (!canTransition(from, to)) {
      throw new AppBusinessError(ERROR_CODES.INVALID_STATUS_TRANSITION, `An application cannot move from ${from} to ${to}`, { from, to });
    }
    const history = [...(application.history ?? []), { from, to, at: new Date(), ...(options.note ? { note: options.note.slice(0, 500) } : {}) }];
    const result = await this.applications.updateAll(
      { ...options.data, status: to, history } as DataObject<JobApplication>,
      { id: application.id, userId: application.userId, status: from },
    );
    if (result.count !== 1) {
      throw new AppConflictError(ERROR_CODES.APPLICATION_CHANGED, 'This application was changed by another action; reload and try again');
    }
    await this.audit.record({
      userId: application.userId,
      action: 'APPLICATION_STATUS_CHANGED',
      entity: 'JobApplication',
      entityId: application.id,
      before: { status: from },
      after: { status: to },
      meta: { actor: options.actor ?? 'user', note: options.note },
    });
    return this.applications.findById(application.id!);
  }
}
