import { expect } from '@loopback/testlab';
import { idString } from '../../../common/utils/id.util';
import { CandidateProfileRepository, JobApplicationRepository, MailConnectorRepository, UserRepository } from '../../../repositories';
import { LoggerService } from '../../../services/common/logger.service';
import { MailConnectorService } from '../../../services/mail/mail-connector.service';
import { ReviewReminderService } from '../../../services/outreach/review-reminder.service';

// The driver bundled with the Mongo connector (what production returns) ships no type definitions.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ObjectId } = require('mongodb') as { ObjectId: new (hex?: string) => { toHexString(): string } };

describe('ReviewReminderService with Mongo ObjectIds', () => {
  it('groups by user even when each row carries a distinct ObjectId instance', async () => {
    const hex = new ObjectId().toHexString();
    const sent: Array<{ userId: string; subject: string }> = [];
    const applications = { find: async () => [{ userId: new ObjectId(hex) }, { userId: new ObjectId(hex) }, { userId: new ObjectId(hex) }] };
    const profiles = { findForUser: async () => ({ id: 'p1' }), updateById: async () => undefined };
    const connectors = { findOne: async () => ({ id: 'm1' }) };
    const users = { findById: async () => ({ email: 'priya@example.test', name: 'Priya' }) };
    const mail = {
      send: async (userId: string, message: { subject: string }) => {
        sent.push({ userId: String(userId), subject: message.subject });
        return { messageId: 'x', provider: 'SMTP' };
      },
    };
    const service = new ReviewReminderService(
      applications as unknown as JobApplicationRepository,
      profiles as unknown as CandidateProfileRepository,
      connectors as unknown as MailConnectorRepository,
      users as unknown as UserRepository,
      mail as unknown as MailConnectorService,
      new LoggerService(),
    );

    expect(await service.sendDue()).to.eql([hex]);
    expect(sent).to.eql([{ userId: hex, subject: '3 tailored resumes waiting for your review' }]);
  });

  it('idString normalises ObjectIds, strings and empties', () => {
    const id = new ObjectId();
    expect(idString(id)).to.equal(id.toHexString());
    expect(idString('abc')).to.equal('abc');
    expect(idString(undefined)).to.equal('');
  });
});
