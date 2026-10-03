import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { OPT_OUT_LINE } from '../../domain/template-render';
import { HiringPostStatus } from '../../models';
import { HiringPostRepository, MailConnectorRepository } from '../../repositories';
import { OutreachService } from '../../services/outreach/outreach.service';
import { ReviewReminderService } from '../../services/outreach/review-reminder.service';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { FakeGmail, FakeSmtp, SMTP_SETTINGS, useFakeMail } from '../helpers/fake-mail';
import { faithfulTailoring, givenListing, givenParsedResume, LlmScript } from '../helpers/tailoring.helper';
import { drainQueues, setupApplication } from '../helpers/test-app';

describe('Mail connectors and outreach (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;
  let user: TestUser;
  let smtp: FakeSmtp;
  let gmail: FakeGmail;
  let script: LlmScript;

  before(async () => {
    ({ app, client } = await setupApplication());
  });

  beforeEach(async () => {
    script = new LlmScript();
    await useFakeLlm(app, new FakeLlmProvider('groq', [request => (request.task === 'OUTREACH_DRAFT' ? personaliseReply : script.reply(request))]));
    ({ smtp, gmail } = await useFakeMail(app, new FakeSmtp(), new FakeGmail()));
    user = await givenUser(client);
    await givenParsedResume(app, client, user);
  });

  after(async () => {
    await app.stop();
  });

  let personaliseReply = '';

  async function approvedApplication(): Promise<string> {
    const listing = await givenListing(app, user.id, { company: 'Globex' });
    const id = (await client.post(`/api/jobs/${listing.id}/tailor`).set(user.auth).expect(200)).body.data.id;
    await drainQueues(app);
    return id;
  }

  async function approve(id: string): Promise<void> {
    await client.post(`/api/applications/${id}/approve`).set(user.auth).expect(200);
  }

  async function connectSmtp(): Promise<void> {
    await client.put('/api/mail-connector/smtp').set(user.auth).send(SMTP_SETTINGS).expect(200);
  }

  it('connects SMTP after verifying, never returns the secret, and rejects bad logins', async () => {
    smtp.failVerify = true;
    const failed = await client.put('/api/mail-connector/smtp').set(user.auth).send(SMTP_SETTINGS).expect(400);
    expect(failed.body.error.code).to.equal('MAIL_CONNECT_FAILED');
    smtp.failVerify = false;

    const view = (await client.put('/api/mail-connector/smtp').set(user.auth).send(SMTP_SETTINGS).expect(200)).body.data;
    expect(view).to.containDeep({ connected: true, provider: 'SMTP', senderEmail: 'priya@example.test' });
    expect(JSON.stringify(view)).to.not.match(/app-password|encryptedSecret/);
    const stored = await (await app.getRepository(MailConnectorRepository)).findOne({ where: { userId: user.id } });
    expect(stored!.encryptedSecret).to.startWith('v1:');
    expect(stored!.encryptedSecret).to.not.containEql('app-password');

    await client.post('/api/mail-connector/test').set(user.auth).expect(200);
    expect(smtp.sent[0].mail.to).to.equal('priya@example.test');
  });

  it('will not draft outreach before the tailored resume is approved', async () => {
    const applicationId = await approvedApplication();
    const response = await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'talent@globex.io' }).expect(400);
    expect(response.body.error.code).to.equal('RESUME_VARIANT_NOT_APPROVED');
  });

  it('drafts from the default template, sends with the approved PDF attached, and drafts one follow-up', async () => {
    await connectSmtp();
    const applicationId = await approvedApplication();
    await approve(applicationId);

    const draft = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'Talent@Globex.io', name: 'Asha' }).expect(200)).body.data;
    expect(draft).to.containDeep({ status: 'DRAFT', toEmail: 'talent@globex.io', subject: 'Application: Senior Backend Engineer at Globex' });
    expect(draft.body).to.startWith('Hi Asha,');
    expect(draft.body).to.containEql(faithfulTailoring().coverNote);
    expect(draft.body).to.endWith(OPT_OUT_LINE);
    expect(smtp.sent).to.have.length(0);

    await client.put(`/api/outreach/${draft.id}`).set(user.auth).send({ subject: 'Senior Backend Engineer — Priya Raman' }).expect(200);
    await client.post(`/api/outreach/${draft.id}/send`).set(user.auth).expect(200);
    await drainQueues(app);

    const sent = (await client.get(`/api/outreach/${draft.id}`).set(user.auth)).body.data;
    expect(sent).to.containDeep({ status: 'SENT', provider: 'SMTP', subject: 'Senior Backend Engineer — Priya Raman' });
    const [{ mail }] = smtp.sent;
    expect(mail.attachments![0].contentType).to.equal('application/pdf');
    expect(mail.attachments![0].content.subarray(0, 5).toString()).to.equal('%PDF-');
    expect(mail.from).to.eql({ name: 'Priya Raman', address: 'priya@example.test' });

    await client.put(`/api/outreach/${draft.id}`).set(user.auth).send({ body: 'changed' }).expect(400);

    const outreach = await app.get<OutreachService>('services.OutreachService');
    expect(await outreach.createDueFollowUps(new Date())).to.equal(0);
    expect(await outreach.createDueFollowUps(new Date(Date.now() + 6 * 86_400_000))).to.equal(1);
    const followUp = (await client.get('/api/outreach?status=DRAFT').set(user.auth)).body.data[0];
    expect(followUp).to.containDeep({ sequence: 2, followUpOf: draft.id, subject: 'Re: Senior Backend Engineer — Priya Raman' });

    await client.post(`/api/outreach/${followUp.id}/send`).set(user.auth).expect(200);
    await drainQueues(app);
    expect(smtp.sent[1].mail.inReplyTo).to.equal(sent.messageId);
    expect(smtp.sent[1].mail.attachments).to.eql([]);
  });

  it('refuses duplicates, do-not-contact recipients and sends over the daily cap', async () => {
    await connectSmtp();
    const applicationId = await approvedApplication();
    await approve(applicationId);
    const first = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'a@globex.io' })).body.data;
    await client.post(`/api/outreach/${first.id}/send`).set(user.auth).expect(200);
    await drainQueues(app);

    const second = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'a@globex.io' })).body.data;
    const duplicate = await client.post(`/api/outreach/${second.id}/send`).set(user.auth).expect(400);
    expect(duplicate.body.error.code).to.equal('OUTREACH_DUPLICATE');

    const contacts = (await client.get('/api/contacts').set(user.auth)).body.data;
    await client.patch(`/api/contacts/${contacts[0].id}`).set(user.auth).send({ doNotContact: true }).expect(200);
    const blocked = await client.post('/api/outreach').set(user.auth).send({ applicationId, contactId: contacts[0].id }).expect(400);
    expect(blocked.body.error.code).to.equal('CONTACT_DO_NOT_CONTACT');

    await client.put('/api/profile').set(user.auth).send({ dailyCaps: { outreach: 1 } }).expect(200);
    const third = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'b@globex.io' })).body.data;
    const capped = await client.post(`/api/outreach/${third.id}/send`).set(user.auth).expect(400);
    expect(capped.body.error.code).to.equal('OUTREACH_DAILY_CAP_REACHED');
  });

  it('requires a connected mailbox to send', async () => {
    const applicationId = await approvedApplication();
    await approve(applicationId);
    const draft = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'x@globex.io' })).body.data;
    await client.post(`/api/outreach/${draft.id}/send`).set(user.auth).expect(200);
    await drainQueues(app);
    const failed = (await client.get(`/api/outreach/${draft.id}`).set(user.auth)).body.data;
    expect(failed).to.containDeep({ status: 'FAILED' });
    expect(failed.error).to.match(/^MAIL_NOT_CONNECTED/);
  });

  it('connects Gmail through OAuth, sends with the stored refresh token, and flags an expired grant', async () => {
    const { url } = (await client.post('/api/mail-connector/gmail/start').set(user.auth).expect(200)).body.data;
    const state = new URL(url).searchParams.get('state')!;
    const callback = await client.get(`/api/mail-connector/gmail/callback?code=abc&state=${encodeURIComponent(state)}`).expect(302);
    const landing = new URL(callback.headers.location);
    expect(landing.origin + landing.pathname).to.equal('http://localhost:5300/settings/mail');
    expect(landing.searchParams.get('gmail')).to.equal('confirm');
    const pending = landing.searchParams.get('pending')!;
    expect(pending).to.not.match(/refresh-abc/);
    const forged = await client.get('/api/mail-connector/gmail/callback?code=abc&state=forged').expect(302);
    expect(forged.headers.location).to.endWith('gmail=error');

    // The callback alone connects nothing: the signed-in user must claim the grant.
    expect((await client.get('/api/mail-connector').set(user.auth)).body.data.connected).to.be.false();
    const view = (await client.post('/api/mail-connector/gmail/confirm').set(user.auth).send({ pending }).expect(200)).body.data;
    expect(view).to.containDeep({ connected: true, provider: 'GMAIL', senderEmail: 'me@gmail.example.test' });

    const applicationId = await approvedApplication();
    await approve(applicationId);
    const draft = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'g@globex.io' })).body.data;
    await client.post(`/api/outreach/${draft.id}/send`).set(user.auth).expect(200);
    await drainQueues(app);
    expect(gmail.sent[0].refreshToken).to.equal('refresh-abc');
    expect((await client.get(`/api/outreach/${draft.id}`).set(user.auth)).body.data.threadId).to.equal('thread-1');

    gmail.failAuth = true;
    await client.post('/api/mail-connector/test').set(user.auth).expect(400);
    expect((await client.get('/api/mail-connector').set(user.auth)).body.data).to.containDeep({ connected: false, status: 'ERROR' });
  });

  it('emails a recruiter straight from a hiring post through Gmail with the primary resume attached', async () => {
    const { url } = (await client.post('/api/mail-connector/gmail/start').set(user.auth).expect(200)).body.data;
    const state = new URL(url).searchParams.get('state')!;
    const callback = await client.get(`/api/mail-connector/gmail/callback?code=post&state=${encodeURIComponent(state)}`).expect(302);
    await client.post('/api/mail-connector/gmail/confirm').set(user.auth).send({ pending: new URL(callback.headers.location).searchParams.get('pending') }).expect(200);

    const posts = await app.getRepository(HiringPostRepository);
    const post = await posts.create({
      userId: user.id,
      source: 'apify-linkedin-posts',
      postUrl: 'https://www.linkedin.com/posts/janakiram_hiring-1',
      author: 'Janakiram R',
      text: "We're hiring a MERN Stack Developer. Mail recruiter2@infolexus.com",
      extractedEmails: ['recruiter2@infolexus.com'],
      title: 'MERN Stack Developer',
      queryUsed: '"hiring" AND "MERN Stack Developer"',
      status: HiringPostStatus.NEW,
    });

    const missing = await client.post('/api/outreach').set(user.auth).send({ email: 'recruiter2@infolexus.com' }).expect(400);
    expect(missing.body.error.code).to.equal('VALIDATION_ERROR');

    const draft = (await client.post('/api/outreach').set(user.auth).send({ hiringPostId: post.id!, email: 'recruiter2@infolexus.com', name: 'Janakiram R' }).expect(200)).body.data;
    expect(draft).to.containDeep({ status: 'DRAFT', subject: 'Application: MERN Stack Developer at Infolexus', hiringPostId: post.id });
    expect(draft.applicationId).to.be.undefined();
    expect(draft.attachmentName).to.match(/\.pdf$/);
    expect(draft.body).to.startWith('Hi Janakiram R,');

    await client.post(`/api/outreach/${draft.id}/send`).set(user.auth).expect(200);
    await drainQueues(app);
    expect((await client.get(`/api/outreach/${draft.id}`).set(user.auth)).body.data.status).to.equal('SENT');
    const [{ mail }] = gmail.sent;
    expect(mail.to).to.equal('recruiter2@infolexus.com');
    expect(mail.attachments).to.have.length(1);
    expect(mail.attachments![0].filename).to.equal(draft.attachmentName);
    expect(mail.attachments![0].content.subarray(0, 5).toString()).to.equal('%PDF-');
    expect((await posts.findById(post.id!)).status).to.equal(HiringPostStatus.CONTACTED);

    const again = (await client.post('/api/outreach').set(user.auth).send({ hiringPostId: post.id, email: 'recruiter2@infolexus.com' })).body.data;
    const duplicate = await client.post(`/api/outreach/${again.id}/send`).set(user.auth).expect(400);
    expect(duplicate.body.error.code).to.equal('OUTREACH_DUPLICATE');
  });

  it('refuses a Gmail grant claimed by anyone but the user who started the sign-in', async () => {
    const { url } = (await client.post('/api/mail-connector/gmail/start').set(user.auth).expect(200)).body.data;
    const state = new URL(url).searchParams.get('state')!;
    const callback = await client.get(`/api/mail-connector/gmail/callback?code=xyz&state=${encodeURIComponent(state)}`).expect(302);
    const pending = new URL(callback.headers.location).searchParams.get('pending')!;

    const victim = await givenUser(client);
    const claimed = await client.post('/api/mail-connector/gmail/confirm').set(victim.auth).send({ pending }).expect(422);
    expect(claimed.body.error.code).to.equal('OAUTH_STATE_INVALID');
    expect((await client.get('/api/mail-connector').set(victim.auth)).body.data.connected).to.be.false();

    const tampered = await client.post('/api/mail-connector/gmail/confirm').set(user.auth).send({ pending: pending.slice(0, -4) + 'AAAA' }).expect(422);
    expect(tampered.body.error.code).to.equal('OAUTH_STATE_INVALID');
  });

  it('only accepts SMTP on mail submission ports', async () => {
    const response = await client.put('/api/mail-connector/smtp').set(user.auth).send({ ...SMTP_SETTINGS, port: 6379 }).expect(422);
    expect(response.body.error.code).to.equal('SMTP_HOST_NOT_ALLOWED');
  });

  it('reports Gmail as unavailable when the server has no OAuth client', async () => {
    gmail.configured = false;
    const response = await client.post('/api/mail-connector/gmail/start').set(user.auth).expect(400);
    expect(response.body.error.code).to.equal('GMAIL_NOT_CONFIGURED');
  });

  it('personalises with the model but discards rewrites that invent numbers', async () => {
    await connectSmtp();
    const applicationId = await approvedApplication();
    await approve(applicationId);
    personaliseReply = JSON.stringify({ subject: 'Your SRE post', body: 'Hi Asha, I saw your post. I have 15 years of experience.' });
    const invented = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'p1@globex.io', personalise: true })).body.data;
    expect(invented.subject).to.equal('Application: Senior Backend Engineer at Globex');

    personaliseReply = JSON.stringify({ subject: 'Your backend post', body: 'Hi Asha, I saw your post about backend roles and would love to talk.' });
    const ok = (await client.post('/api/outreach').set(user.auth).send({ applicationId, email: 'p2@globex.io', personalise: true })).body.data;
    expect(ok.subject).to.equal('Your backend post');
    expect(ok.body).to.endWith(OPT_OUT_LINE);
  });

  it('manages templates and rejects unknown placeholders', async () => {
    const [seeded] = (await client.get('/api/outreach-templates').set(user.auth).expect(200)).body.data;
    expect(seeded.isDefault).to.be.true();
    const bad = await client.post('/api/outreach-templates').set(user.auth).send({ name: 'x', subject: 'Hi', body: '{{salary}}' }).expect(422);
    expect(bad.body.error.code).to.equal('TEMPLATE_INVALID');
    const created = (await client.post('/api/outreach-templates').set(user.auth).send({ name: 'Short', subject: '{{jobTitle}}', body: 'Hi {{recruiterName}}', isDefault: true }).expect(200)).body.data;
    const list = (await client.get('/api/outreach-templates').set(user.auth)).body.data;
    expect(list.filter((t: { isDefault: boolean }) => t.isDefault).map((t: { id: string }) => t.id)).to.eql([created.id]);
    await client.del(`/api/outreach-templates/${created.id}`).set(user.auth).expect(204);
    const last = await client.del(`/api/outreach-templates/${seeded.id}`).set(user.auth).expect(400);
    expect(last.body.error.code).to.equal('OUTREACH_TEMPLATE_LAST');
  });

  it('reminds users about resumes waiting for review, at most once a day', async () => {
    await connectSmtp();
    await approvedApplication();
    const reminders = await app.get<ReviewReminderService>('services.ReviewReminderService');
    const threeDaysLater = new Date(Date.now() + 3 * 86_400_000);
    expect(await reminders.sendDue(threeDaysLater)).to.containEql(user.id);
    expect(smtp.sent.at(-1)!.mail.to).to.equal(user.email);
    expect(smtp.sent.at(-1)!.mail.subject).to.equal('1 tailored resume waiting for your review');
    expect(await reminders.sendDue(threeDaysLater)).to.not.containEql(user.id);
  });
});
