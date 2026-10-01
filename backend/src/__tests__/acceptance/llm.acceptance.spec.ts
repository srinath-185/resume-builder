import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { LlmRouterService } from '../../services/llm/llm-router.service';
import { LlmTask } from '../../services/llm/llm.types';
import { givenUser } from '../helpers/auth.helper';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { setupApplication } from '../helpers/test-app';

describe('LLM status (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;

  before(async () => {
    ({ app, client } = await setupApplication());
  });

  after(async () => {
    await app.stop();
  });

  it('requires authentication', async () => {
    await client.get('/api/llm/status').expect(401);
  });

  it('reports providers, routes and the caller’s usage today', async () => {
    const groq = new FakeLlmProvider('groq', ['hello']);
    await useFakeLlm(app, groq);
    const user = await givenUser(client);
    const router = await app.get<LlmRouterService>('services.LlmRouterService');
    await router.complete({ task: LlmTask.COVER_NOTE, messages: [{ role: 'user', content: 'hi' }], userId: user.id });

    const response = await client.get('/api/llm/status').set(user.auth).expect(200);
    const { providers, routes, usageToday } = response.body.data;
    expect(providers[0]).to.containDeep({ provider: 'groq', configured: true, requestsThisMinute: 1, tokensToday: 150 });
    expect(routes.RESUME_TAILOR).to.eql(['groq', 'gemini', 'opencode', 'anthropic']);
    expect(usageToday).to.eql([{ provider: 'groq', task: 'COVER_NOTE', calls: 1, failures: 0, inputTokens: 100, outputTokens: 50 }]);
  });
});
