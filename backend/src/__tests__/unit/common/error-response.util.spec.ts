import { expect } from '@loopback/testlab';
import { AppBusinessError, AppNotFoundError, ERROR_CODES, toErrorResponse, UpstreamHttpError } from '../../../common/errors';

describe('toErrorResponse', () => {
  it('keeps the code and status of an AppError', () => {
    const { status, body } = toErrorResponse(new AppBusinessError('SOME_RULE', 'Rule broken', { field: 'x' }));
    expect(status).to.equal(400);
    expect(body).to.eql({ success: false, error: { code: 'SOME_RULE', message: 'Rule broken', details: { field: 'x' } } });
  });

  it('maps framework http errors by status', () => {
    const { status, body } = toErrorResponse({ statusCode: 401, message: 'Authorization header not found' });
    expect(status).to.equal(401);
    expect(body.error.code).to.equal(ERROR_CODES.UNAUTHENTICATED);
  });

  it('hides unexpected errors behind an opaque 500', () => {
    const { status, body } = toErrorResponse(new Error('connection string mongodb://user:pw@host'));
    expect(status).to.equal(500);
    expect(body.error.message).to.equal('Internal server error');
  });

  it('reports upstream failures as 502 with the service name', () => {
    const { status, body } = toErrorResponse(new UpstreamHttpError('groq', 'groq responded 503', 503));
    expect(status).to.equal(502);
    expect(body.error.code).to.equal(ERROR_CODES.UPSTREAM_UNAVAILABLE);
    expect(body.error.details).to.eql({ service: 'groq', upstreamStatus: 503 });
  });

  it('uses a custom code on not-found errors', () => {
    expect(toErrorResponse(new AppNotFoundError('RESUME_NOT_FOUND')).body.error.code).to.equal('RESUME_NOT_FOUND');
  });
});

describe('UpstreamHttpError classification', () => {
  it('treats 429 as rate limited, not a client error', () => {
    const error = new UpstreamHttpError('groq', 'x', 429);
    expect(error.isRateLimited).to.be.true();
    expect(error.isClientError).to.be.false();
  });

  it('treats 401 as a client error', () => {
    expect(new UpstreamHttpError('groq', 'x', 401).isClientError).to.be.true();
  });
});
