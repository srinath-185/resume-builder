import { expect } from '@loopback/testlab';
import { DEFAULT_TEMPLATE, renderTemplate, unknownPlaceholders } from '../../../domain/template-render';
import { base64Url, composeMime } from '../../../services/mail/mail-transports';

describe('Outreach templates', () => {
  it('renders placeholders and falls back to "there" for a missing recruiter name', () => {
    const body = renderTemplate(DEFAULT_TEMPLATE.body, { company: 'Globex', jobTitle: 'SRE', coverNote: 'I run payment systems.', senderName: 'Priya' });
    expect(body).to.startWith('Hi there,');
    expect(body).to.containEql('the SRE role at Globex');
    expect(body).to.containEql('I run payment systems.');
    expect(body).to.endWith('Priya');
  });

  it('collapses blank lines left by empty values', () => {
    expect(renderTemplate('A\n\n{{coverNote}}\n\nB', {})).to.equal('A\n\nB');
  });

  it('lists unknown placeholders', () => {
    expect(unknownPlaceholders('Hi {{recruiterName}} {{salary}} {{ company }} {{salary}}')).to.eql(['salary']);
  });
});

describe('MIME composition', () => {
  it('builds a message with headers and a PDF attachment', async () => {
    const mime = (
      await composeMime({
        from: { name: 'Priya', address: 'priya@example.test' },
        to: 'talent@globex.io',
        subject: 'Application: SRE',
        text: 'Hello',
        messageId: '<abc@example.test>',
        inReplyTo: '<parent@example.test>',
        attachments: [{ filename: 'resume.pdf', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' }],
      })
    ).toString();
    expect(mime).to.match(/^From: Priya <priya@example\.test>/m);
    expect(mime).to.match(/^Message-ID: <abc@example\.test>/m);
    expect(mime).to.match(/^In-Reply-To: <parent@example\.test>/m);
    expect(mime).to.match(/Content-Type: application\/pdf; name=resume\.pdf/);
  });

  it('encodes base64url without padding', () => {
    expect(base64Url(Buffer.from([0xfb, 0xff]))).to.equal('-_8');
  });
});
