import { Client } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { jobFingerprint } from '../../domain/job-normalise';
import { ResumeDocument } from '../../domain/resume-document';
import { JobListing, JobListingStatus, MatchStatus } from '../../models';
import { JobListingRepository } from '../../repositories';
import { LlmRequest } from '../../services/llm/llm.types';
import { TestUser } from './auth.helper';
import { SAMPLE_PARSE_REPLY, SAMPLE_RESUME_DOCUMENT, SAMPLE_RESUME_TEXT } from './fixtures';
import { drainQueues } from './test-app';

export const JD_KEYWORDS_REPLY = JSON.stringify({ mustHave: ['Node.js', 'Kafka', 'Kubernetes'], niceToHave: ['Redis'], seniority: 'Senior' });

/** A faithful tailoring: reordered skills, new summary from existing facts, reordered bullets. */
export function faithfulTailoring(): { document: ResumeDocument; changes: Array<{ path: string; reason: string }>; coverNote: string; formAnswers: Array<{ question: string; answer: string }> } {
  const document = JSON.parse(JSON.stringify(SAMPLE_RESUME_DOCUMENT)) as ResumeDocument;
  document.summary = 'Senior backend engineer building Node.js payment services with Kafka and Redis.';
  document.skills = ['Node.js', 'Kafka', 'Redis', 'TypeScript', 'MongoDB', 'AWS'];
  document.experience[0].bullets = [...document.experience[0].bullets].reverse();
  return {
    document,
    changes: [
      { path: 'summary', reason: 'Targets the payments backend role' },
      { path: 'skills', reason: 'Puts the required Node.js and Kafka first' },
    ],
    coverNote: 'I build Node.js payment services at Acme Payments and would like to bring that to Globex.',
    formAnswers: [{ question: 'Why are you a good fit?', answer: 'I lead Node.js payment services today.' }],
  };
}

export class LlmScript {
  tailorReply: string = JSON.stringify(faithfulTailoring());
  matchScore = 90;

  reply = (request: LlmRequest): string => {
    switch (request.task) {
      case 'RESUME_PARSE':
        return SAMPLE_PARSE_REPLY;
      case 'JD_KEYWORDS':
        return JD_KEYWORDS_REPLY;
      case 'RESUME_TAILOR':
        return this.tailorReply;
      case 'JOB_MATCH_SCORE': {
        const ids = [...request.messages[0].content.matchAll(/### Job (\d+)/g)].map(match => match[1]);
        return JSON.stringify({ results: ids.map(id => ({ id, score: this.matchScore, reason: 'fit', matchedSkills: [], missingSkills: [] })) });
      }
      default:
        return 'ok';
    }
  };
}

export async function givenParsedResume(app: ResumeBuilderApplication, client: Client, user: TestUser): Promise<string> {
  const response = await client.post('/api/resumes').set(user.auth).attach('file', Buffer.from(SAMPLE_RESUME_TEXT), 'priya.txt');
  await drainQueues(app);
  return response.body.data.id;
}

export async function givenListing(app: ResumeBuilderApplication, userId: string, overrides: Partial<JobListing> = {}): Promise<JobListing> {
  const repo = await app.getRepository(JobListingRepository);
  const base = { title: 'Senior Backend Engineer', company: `Globex ${Math.random().toString(36).slice(2, 7)}`, location: 'Chennai' };
  return repo.create({
    userId,
    fingerprint: jobFingerprint({ ...base, ...overrides }),
    source: 'jsearch',
    seenOn: ['jsearch'],
    externalId: `x-${Date.now()}-${Math.random()}`,
    url: 'https://jobs.example.test/1',
    applyUrl: 'https://jobs.example.test/1/apply',
    applyOptions: [],
    description: 'Build payment services in Node.js with Kafka. Kubernetes experience required. Redis is a plus.',
    status: JobListingStatus.NEW,
    matchStatus: MatchStatus.SCORED,
    matchScore: 88,
    matchedSkills: [],
    missingSkills: [],
    ...base,
    ...overrides,
  });
}
