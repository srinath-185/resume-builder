import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { LlmStatus, LlmStatusService } from '../../services/llm/llm-status.service';

@authenticate('jwt')
export class LlmController {
  constructor(@inject('services.LlmStatusService') private statusService: LlmStatusService) {}

  /** Which AI providers are configured, their remaining free budget, routing, and the caller's usage today. */
  @get('/llm/status')
  status(@inject(SecurityBindings.USER) profile: UserProfile): Promise<LlmStatus> {
    return this.statusService.status(currentUserId(profile));
  }
}
