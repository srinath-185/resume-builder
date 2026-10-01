import { expect } from '@loopback/testlab';
import { redactSecrets } from '../../../common/utils/redact.util';
import { parsePage } from '../../../common/utils/list-query.util';
import { EncryptionService } from '../../../services/common/encryption.service';

describe('EncryptionService', () => {
  const service = new EncryptionService();

  it('round-trips a value', () => {
    const cipher = service.encrypt('refresh-token-123');
    expect(cipher.startsWith('v1:')).to.be.true();
    expect(cipher).to.not.containEql('refresh-token-123');
    expect(service.decrypt(cipher)).to.equal('refresh-token-123');
  });

  it('produces a different ciphertext each time', () => {
    expect(service.encrypt('same')).to.not.equal(service.encrypt('same'));
  });

  it('rejects a tampered ciphertext', () => {
    const parts = service.encrypt('secret').split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => service.decrypt(parts.join(':'))).to.throw();
  });

  it('round-trips JSON', () => {
    expect(service.decryptJson(service.encryptJson({ a: [1, 2] }))).to.eql({ a: [1, 2] });
  });
});

describe('redactSecrets', () => {
  it('redacts secret-looking keys at any depth', () => {
    const output = redactSecrets({ email: 'a@b.c', auth: { refreshToken: 'x', apiKey: 'y' }, list: [{ password: 'p' }] });
    expect(output).to.eql({ email: 'a@b.c', auth: { refreshToken: '[REDACTED]', apiKey: '[REDACTED]' }, list: [{ password: '[REDACTED]' }] });
  });
});

describe('parsePage', () => {
  it('clamps page and limit', () => {
    expect(parsePage('0', '1000')).to.eql({ page: 1, limit: 100, skip: 0 });
    expect(parsePage(3, 10)).to.eql({ page: 3, limit: 10, skip: 20 });
    expect(parsePage('abc', undefined)).to.eql({ page: 1, limit: 20, skip: 0 });
  });
});
