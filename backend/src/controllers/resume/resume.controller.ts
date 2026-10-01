import { authenticate } from '@loopback/authentication';
import { inject } from '@loopback/core';
import { del, get, param, patch, post, Request, requestBody, Response, RestBindings } from '@loopback/rest';
import { SecurityBindings, UserProfile } from '@loopback/security';
import { currentUserId } from '../../authentication/jwt.strategy';
import { sendFile } from '../../common/utils/send-file.util';
import { Resume } from '../../models';
import { ResumeService } from '../../services/resume/resume.service';

@authenticate('jwt')
export class ResumeController {
  constructor(@inject('services.ResumeService') private resumeService: ResumeService) {}

  /** Multipart upload, field "file" (PDF, DOCX or TXT). Parsing runs in the background. */
  @post('/resumes')
  upload(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @requestBody({
      description: 'multipart/form-data with a "file" field',
      required: true,
      content: { 'multipart/form-data': { 'x-parser': 'stream', schema: { type: 'object' } } },
    })
    request: Request,
    @inject(RestBindings.Http.RESPONSE) response: Response,
  ): Promise<Resume> {
    return this.resumeService.upload(currentUserId(profile), request, response);
  }

  @get('/resumes')
  list(@inject(SecurityBindings.USER) profile: UserProfile): Promise<Resume[]> {
    return this.resumeService.list(currentUserId(profile));
  }

  @get('/resumes/{id}')
  findById(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<Resume> {
    return this.resumeService.get(currentUserId(profile), id);
  }

  /** Save corrections to the parsed document. */
  @patch('/resumes/{id}/document')
  updateDocument(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @requestBody({ content: { 'application/json': { schema: { type: 'object' } } } }) document: object,
  ): Promise<Resume> {
    return this.resumeService.updateDocument(currentUserId(profile), id, document);
  }

  @post('/resumes/{id}/primary')
  setPrimary(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<Resume> {
    return this.resumeService.setPrimary(currentUserId(profile), id);
  }

  @post('/resumes/{id}/reparse')
  reparse(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @param.query.boolean('force') force?: boolean,
  ): Promise<Resume> {
    return this.resumeService.reparse(currentUserId(profile), id, force ?? false);
  }

  @del('/resumes/{id}')
  async remove(@inject(SecurityBindings.USER) profile: UserProfile, @param.path.string('id') id: string): Promise<void> {
    await this.resumeService.delete(currentUserId(profile), id);
  }

  /** The original uploaded file. */
  @get('/resumes/{id}/file')
  async download(
    @inject(SecurityBindings.USER) profile: UserProfile,
    @param.path.string('id') id: string,
    @inject(RestBindings.Http.RESPONSE) response: Response,
  ): Promise<Response> {
    const file = await this.resumeService.file(currentUserId(profile), id);
    return sendFile(response, file.data, file.mimeType, file.fileName);
  }
}
