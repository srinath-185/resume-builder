import http from 'http';
import { AddressInfo } from 'net';

const FORM = (extra: string) => `<!doctype html><html><body>
<h1>Senior Backend Engineer</h1>
<form action="/submit" method="post" enctype="multipart/form-data">
  <label for="fn">First Name *</label><input id="fn" name="first_name" required>
  <label for="ln">Last Name *</label><input id="ln" name="last_name" required>
  <label for="em">Email *</label><input id="em" name="email" type="email" required>
  <label for="ph">Phone</label><input id="ph" name="phone" type="tel">
  <label for="cv">Resume/CV *</label><input id="cv" name="resume" type="file" required>
  <label for="cl">Cover Letter</label><textarea id="cl" name="cover_letter"></textarea>
  <label for="q1">Why are you a good fit for this role? *</label><textarea id="q1" name="q1" required></textarea>
  <label><input type="checkbox" name="newsletter"> Send me job alerts</label>
  ${extra}
  <button type="submit">Submit Application</button>
</form></body></html>`;

/** A tiny local "applicant tracking system" for driving the real browser in tests. */
export class FakeJobSite {
  readonly submissions: string[] = [];
  private server?: http.Server;

  async start(): Promise<string> {
    this.server = http.createServer((request, response): void => {
      const send = (body: string) => response.writeHead(200, { 'content-type': 'text/html' }).end(body);
      if (request.method === 'POST' && request.url === '/submit') {
        const chunks: Buffer[] = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
          this.submissions.push(Buffer.concat(chunks).toString('latin1'));
          send('<html><body><h1>Thank you for applying!</h1></body></html>');
        });
        return;
      }
      const pages: Record<string, string> = {
        '/job/ok': '<html><body><h1>Senior Backend Engineer</h1><a href="/apply/ok">Apply</a></body></html>',
        '/apply/ok': FORM(''),
        '/apply/salary': FORM('<label for="sal">What is your expected salary? *</label><input id="sal" name="salary" required>'),
        '/apply/captcha': FORM('<div class="g-recaptcha" data-sitekey="x"></div>'),
      };
      const page = pages[request.url ?? ''];
      if (page) send(page);
      else response.writeHead(404).end();
    });
    await new Promise<void>(resolve => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise(resolve => this.server?.close(resolve));
  }
}
