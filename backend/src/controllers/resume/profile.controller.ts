import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get, put, requestBody } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { CandidateProfile } from '../../models';
import { CandidateProfileService, ProfileUpdate } from '../../services/resume/candidate-profile.service';

const STRING_LIST = { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 150 } as const;
const CAP = { type: 'integer', minimum: 0, maximum: 200 } as const;

@authenticate('jwt')
export class ProfileController {
  constructor(@inject('services.CandidateProfileService') private profileService: CandidateProfileService) {}

  @get('/profile')
  get(@inject(SecurityBindings.USER) profile: UserProfile): Promise<CandidateProfile> {
    return this.profileService.get(currentUserId(profile));
  }

  @put('/profile')
  update(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @requestBody({
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              targetTitles: { ...STRING_LIST, maxItems: 10 },
              skills: STRING_LIST,
              yearsExperience: { type: 'integer', minimum: 0, maximum: 60 },
              location: { type: 'string', maxLength: 120, nullable: true },
              remoteOnly: { type: 'boolean' },
              seniority: { type: 'string', maxLength: 60, nullable: true },
              autoTailorThreshold: { type: 'integer', minimum: 0, maximum: 101 },
              dailyCaps: {
                type: 'object',
                additionalProperties: false,
                properties: { tailor: CAP, apply: CAP, outreach: CAP },
              },
              defaultTemplateId: { type: 'string', maxLength: 60, nullable: true },
              hiringQueryTemplate: { type: 'string', maxLength: 300, nullable: true },
              hiringQueryTitle: { type: 'string', maxLength: 300, nullable: true },
              hiringQueryLocation: { type: 'string', maxLength: 120, nullable: true },
              autoApplyOnApprove: { type: 'boolean' },
            },
          },
        },
      },
    })
    body: ProfileUpdate,
  ): Promise<CandidateProfile> {
    return this.profileService.update(currentUserId(profile), body);
  }
}
