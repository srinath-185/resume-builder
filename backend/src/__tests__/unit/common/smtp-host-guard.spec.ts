import { expect } from '@loopback/testlab';
import { isPublicAddress, resolveSmtpAddress, SmtpHostNotAllowedError } from '../../../services/mail/mail-transports';
import { withEnv } from '../../helpers/auth.helper';

describe('SMTP host guard', () => {
  it('treats loopback, private, link-local, CGNAT, multicast and IPv4-mapped private addresses as non-public', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip']) {
      expect({ address, public: isPublicAddress(address) }).to.eql({ address, public: false });
    }
    for (const address of ['142.250.4.108', '8.8.8.8', '2607:f8b0:4004:c07::6c', '::ffff:8.8.8.8']) {
      expect({ address, public: isPublicAddress(address) }).to.eql({ address, public: true });
    }
  });

  it('pins the connection to a checked public address', async () => {
    expect(await resolveSmtpAddress('smtp.example.test', async () => ['142.250.4.108'])).to.equal('142.250.4.108');
  });

  it('refuses a name that resolves to an internal address, even alongside a public one', async () => {
    await expect(resolveSmtpAddress('rebind.example.test', async () => ['142.250.4.108', '127.0.0.1'])).to.be.rejectedWith(SmtpHostNotAllowedError);
    await expect(resolveSmtpAddress('169.254.169.254')).to.be.rejectedWith(SmtpHostNotAllowedError);
    await expect(resolveSmtpAddress('nowhere.example.test', async () => [])).to.be.rejectedWith(/could not be resolved/);
  });

  it('can be switched off for a self-hosted private relay', async () => {
    await withEnv({ SMTP_ALLOW_PRIVATE_HOSTS: 'true' }, async () => {
      expect(await resolveSmtpAddress('mail.internal')).to.equal('mail.internal');
    });
  });
});
