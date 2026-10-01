import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { get, param, Response, RestBindings } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { AppBusinessError, ERROR_CODES } from '../../common/errors';
import { sendFile } from '../../common/utils/send-file.util';
import { ResumeRenderService } from '../../services/render/resume-render.service';
import { ResumeTemplate } from '../../services/render/resume-templates';
import { CandidateProfileService } from '../../services/resume/candidate-profile.service';
import { ResumeService } from '../../services/resume/resume.service';

@authenticate('jwt')
export class ResumeRenderController {
  constructor(
    @inject('services.ResumeRenderService') private renderer: ResumeRenderService,
    @inject('services.ResumeService') private resumes: ResumeService,
    @inject('services.CandidateProfileService') private profiles: CandidateProfileService,
  ) {}

  @get('/resume-templates')
  templates(): Array<Omit<ResumeTemplate, 'style'>> {
    return this.renderer.templates();
  }

  /** Renders the (corrected) parsed document as a PDF, for preview before any tailoring. */
  @get('/resumes/{id}/pdf')
  async pdf(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @param.query.string('template') template: string | undefined,
    @inject(RestBindings.Http.RESPONSE) response: Response,
  ): Promise<Response> {
    const userId = currentUserId(profile);
    const resume = await this.resumes.get(userId, id);
    if (!resume.document) throw new AppBusinessError(ERROR_CODES.RESUME_NOT_PARSED, 'This resume has not been parsed yet');
    const templateId = template ?? (await this.profiles.get(userId)).defaultTemplateId;
    const pdf = await this.renderer.render(resume.document, templateId);
    const baseName = resume.fileName.replace(/\.[^.]+$/, '');
    return sendFile(response, pdf, 'application/pdf', `${baseName}.pdf`, true);
  }
}
