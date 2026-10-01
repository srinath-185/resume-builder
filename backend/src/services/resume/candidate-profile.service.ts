import { BindingScope, inject, injectable } from '@loopback/core';
import { ResumeDocument, yearsOfExperience } from '../../domain/resume-document';
import { CandidateProfile, DEFAULT_AUTO_TAILOR_THRESHOLD, DEFAULT_DAILY_CAPS, DailyCaps } from '../../models';
import { CandidateProfileRepository } from '../../repositories';
import { AuditService } from '../audit/audit.service';

export interface ProfileUpdate {
  targetTitles?: string[];
  skills?: string[];
  yearsExperience?: number;
  location?: string | null;
  remoteOnly?: boolean;
  seniority?: string | null;
  autoTailorThreshold?: number;
  dailyCaps?: Partial<DailyCaps>;
  defaultTemplateId?: string | null;
}

const MAX_SEEDED_SKILLS = 40;

function cleanList(values: string[] | undefined, max: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values ?? []) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      output.push(trimmed);
    }
    if (output.length >= max) break;
  }
  return output;
}

@injectable({ scope: BindingScope.TRANSIENT })
export class CandidateProfileService {
  constructor(
    @inject('repositories.CandidateProfileRepository') private profiles: CandidateProfileRepository,
    @inject('services.AuditService') private audit: AuditService,
  ) {}

  async get(userId: string): Promise<CandidateProfile> {
    const existing = await this.profiles.findForUser(userId);
    if (existing) return existing;
    return this.profiles.create({
      userId,
      targetTitles: [],
      skills: [],
      remoteOnly: false,
      autoTailorThreshold: DEFAULT_AUTO_TAILOR_THRESHOLD,
      dailyCaps: { ...DEFAULT_DAILY_CAPS },
    });
  }

  async update(userId: string, patch: ProfileUpdate): Promise<CandidateProfile> {
    const before = await this.get(userId);
    const data: Partial<CandidateProfile> = {};
    if (patch.targetTitles) data.targetTitles = cleanList(patch.targetTitles, 10);
    if (patch.skills) data.skills = cleanList(patch.skills, 150);
    if (patch.yearsExperience !== undefined) data.yearsExperience = patch.yearsExperience;
    if (patch.location !== undefined) data.location = patch.location?.trim() || undefined;
    if (patch.remoteOnly !== undefined) data.remoteOnly = patch.remoteOnly;
    if (patch.seniority !== undefined) data.seniority = patch.seniority?.trim() || undefined;
    if (patch.autoTailorThreshold !== undefined) data.autoTailorThreshold = patch.autoTailorThreshold;
    if (patch.dailyCaps) data.dailyCaps = { ...DEFAULT_DAILY_CAPS, ...before.dailyCaps, ...patch.dailyCaps };
    if (patch.defaultTemplateId !== undefined) data.defaultTemplateId = patch.defaultTemplateId ?? undefined;

    await this.profiles.updateById(before.id!, data);
    const after = await this.profiles.findById(before.id!);
    await this.audit.record({ userId, action: 'PROFILE_UPDATED', entity: 'CandidateProfile', entityId: before.id, before: { ...before }, after: data });
    return after;
  }

  /** Fills only empty fields from a parsed resume, so user edits are never overwritten. */
  async seedFromResume(userId: string, document: ResumeDocument, resumeId: string): Promise<CandidateProfile> {
    const profile = await this.get(userId);
    const data: Partial<CandidateProfile> = {};
    if (profile.targetTitles.length === 0) {
      data.targetTitles = cleanList(document.experience.slice(0, 2).map(role => role.title), 3);
    }
    if (profile.skills.length === 0) data.skills = cleanList(document.skills, MAX_SEEDED_SKILLS);
    if (profile.yearsExperience === undefined) data.yearsExperience = yearsOfExperience(document);
    if (!profile.location && document.contact.location) data.location = document.contact.location;
    if (!profile.primaryResumeId) data.primaryResumeId = resumeId;
    if (Object.keys(data).length > 0) await this.profiles.updateById(profile.id!, data);
    return this.profiles.findById(profile.id!);
  }

  async setPrimaryResume(userId: string, resumeId: string | undefined): Promise<void> {
    const profile = await this.get(userId);
    await this.profiles.updateById(profile.id!, { primaryResumeId: resumeId });
  }
}
