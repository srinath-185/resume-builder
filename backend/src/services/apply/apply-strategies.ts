import { Page } from 'puppeteer-core';
import { ApplicantData } from '../../domain/apply-fields';
import { clickSubmit, fillForm, hasCaptcha, looksSubmitted } from './form-filler';

export interface ApplyContext {
  url: string;
  data: ApplicantData;
  resumePath: string;
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; expires?: number }>;
}

export interface ApplyResult {
  outcome: 'APPLIED' | 'NEEDS_REVIEW';
  reason?: string;
  details?: string[];
  sessionExpired?: boolean;
}

const needsReview = (reason: string, details?: string[], extra: Partial<ApplyResult> = {}): ApplyResult => ({ outcome: 'NEEDS_REVIEW', reason, details, ...extra });

/** Clicks the first visible link/button whose text is just "Apply" (job page → form page). */
async function openApplicationForm(page: Page): Promise<void> {
  if (await page.$('input[type=file]')) return;
  const opened = await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll<HTMLElement>('a, button')).find(
      element => /^apply( (now|for this job))?$/i.test((element.textContent ?? '').trim()) && element.getClientRects().length > 0,
    );
    target?.click();
    return Boolean(target);
  });
  if (opened) await Promise.race([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))]);
}

/**
 * Greenhouse, Lever, Ashby, Workday-style single-page forms. Submits only
 * when the resume was uploaded and every required field was filled from
 * approved data; otherwise stops with the list of what is missing.
 */
export async function runAtsForm(page: Page, context: ApplyContext): Promise<ApplyResult> {
  await page.goto(context.url, { waitUntil: 'domcontentloaded' });
  await openApplicationForm(page);
  if (await hasCaptcha(page)) return needsReview('The application form has a CAPTCHA; finish it yourself');

  const scope = (await page.$('form input[type=file]')) ? 'form:has(input[type=file])' : 'body';
  const fill = await fillForm(page, scope, context.data, context.resumePath);
  if (fill.captcha) return needsReview('The application form has a CAPTCHA; finish it yourself');
  if (fill.fileInputs === 0 || !fill.resumeUploaded) return needsReview('No resume upload field was found on the form');
  if (fill.missingRequired.length > 0) return needsReview('Some required questions have no approved answer', fill.missingRequired);

  if (!(await clickSubmit(page, scope))) return needsReview('Could not find the submit button');
  if (await hasCaptcha(page)) return needsReview('A CAPTCHA appeared after submitting; finish it yourself');
  return (await looksSubmitted(page)) ? { outcome: 'APPLIED' } : needsReview('Submitted, but no confirmation was shown; check the screenshot');
}

const MAX_EASY_APPLY_STEPS = 8;

async function clickByLabel(page: Page, scope: string, pattern: RegExp): Promise<boolean> {
  return page.evaluate(
    (scopeSelector, source) => {
      const root = document.querySelector(scopeSelector) ?? document.body;
      const regex = new RegExp(source, 'i');
      const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
        element => regex.test(element.getAttribute('aria-label') ?? '') || regex.test((element.textContent ?? '').trim()),
      );
      button?.click();
      return Boolean(button);
    },
    scope,
    pattern.source,
  );
}

/**
 * LinkedIn Easy Apply with the user's own session cookie. Best-effort: the
 * page structure changes often, and any step it does not fully understand
 * ends in NEEDS_REVIEW rather than a guess. Automating LinkedIn may breach
 * its terms; this runs only for users who saved a session explicitly.
 */
export async function runLinkedInEasyApply(page: Page, context: ApplyContext): Promise<ApplyResult> {
  if (!context.cookies?.length) return needsReview('Save your LinkedIn session to use Easy Apply, or apply manually');
  await page.setCookie(...context.cookies.map(cookie => ({ domain: '.linkedin.com', path: '/', secure: true, ...cookie })));
  await page.goto(context.url, { waitUntil: 'domcontentloaded' });
  if (/\/(login|authwall|checkpoint)/.test(page.url())) return needsReview('Your LinkedIn session has expired; save a new one', undefined, { sessionExpired: true });

  if (!(await clickByLabel(page, 'body', /^easy apply/))) return needsReview('This job uses the employer’s own site; apply there with the approved PDF');
  await page.waitForSelector('[role=dialog]', { timeout: 10_000 }).catch(() => undefined);

  for (let step = 0; step < MAX_EASY_APPLY_STEPS; step++) {
    const fill = await fillForm(page, '[role=dialog]', context.data, context.resumePath);
    if (fill.captcha) return needsReview('LinkedIn asked for a verification check; finish it yourself');
    if (fill.missingRequired.length > 0) return needsReview('Some Easy Apply questions have no approved answer', fill.missingRequired);

    if (await clickByLabel(page, '[role=dialog]', /^submit application/)) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const text = await page.evaluate(() => document.body?.innerText ?? '');
      return /application (was )?sent|you applied|applied \d/i.test(text) ? { outcome: 'APPLIED' } : needsReview('Submitted, but LinkedIn did not confirm; check the screenshot');
    }
    const advanced = (await clickByLabel(page, '[role=dialog]', /^review/)) || (await clickByLabel(page, '[role=dialog]', /continue to next step|^next$/));
    if (!advanced) return needsReview('Easy Apply showed a step this agent does not recognise');
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  return needsReview('Easy Apply had more steps than expected');
}
