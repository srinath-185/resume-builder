import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { setupApplication } from '../helpers/test-app';

describe('Foundation (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;

  before(async () => {
    ({ app, client } = await setupApplication());
  });

  after(async () => {
    await app.stop();
  });

  it('wraps successful responses in the success envelope', async () => {
    const response = await client.get('/api/health').expect(200);
    expect(response.body.success).to.be.true();
    expect(response.body.data.status).to.equal('ok');
  });

  it('returns the error envelope for an unknown route', async () => {
    const response = await client.get('/api/does-not-exist').expect(404);
    expect(response.body).to.eql({ success: false, error: { code: 'NOT_FOUND', message: response.body.error.message } });
  });

  it('serves the OpenAPI spec', async () => {
    const response = await client.get('/api/openapi.json').expect(200);
    expect(response.body.paths).to.have.property('/health');
  });
});
