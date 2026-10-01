import { BindingScope, injectable } from '@loopback/core';
import { GmailApi, GoogleGmailApi, NodemailerSmtpApi, SmtpApi } from './mail-transports';

/** Holds the Gmail and SMTP transports; tests swap in fakes. */
@injectable({ scope: BindingScope.SINGLETON })
export class MailTransportRegistryService {
  gmail: GmailApi = new GoogleGmailApi();
  smtp: SmtpApi = new NodemailerSmtpApi();

  replace(transports: { gmail?: GmailApi; smtp?: SmtpApi }): void {
    if (transports.gmail) this.gmail = transports.gmail;
    if (transports.smtp) this.smtp = transports.smtp;
  }
}
