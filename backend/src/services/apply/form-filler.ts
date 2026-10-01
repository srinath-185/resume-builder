import { ElementHandle, Page } from 'puppeteer-core';
import { ApplicantData, classifyField, FieldKind, valueFor } from '../../domain/apply-fields';

interface FieldInfo {
  id: string;
  tag: 'input' | 'textarea' | 'select';
  type: string;
  label: string;
  required: boolean;
  hasValue: boolean;
  options: string[];
}

export interface FormFillOutcome {
  filled: Array<{ label: string; kind: FieldKind }>;
  missingRequired: string[];
  captcha: boolean;
  resumeUploaded: boolean;
  fileInputs: number;
}

const CAPTCHA_SELECTOR = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '[data-sitekey]',
].join(',');

export async function hasCaptcha(page: Page): Promise<boolean> {
  return (await page.$(CAPTCHA_SELECTOR)) !== null;
}

/** Tags every fillable field inside `scope` with data-rb-id and returns what each one asks for. */
async function collectFields(page: Page, scope: string): Promise<FieldInfo[]> {
  return page.evaluate(scopeSelector => {
    const root = document.querySelector(scopeSelector) ?? document.body;
    const textOf = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const elements = Array.from(
      root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select',
      ),
    );
    return elements
      .filter(element => (element as HTMLInputElement).type === 'file' || element.getClientRects().length > 0)
      .map((element, index) => {
        element.setAttribute('data-rb-id', String(index));
        const byFor = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
        const labelledBy = element.getAttribute('aria-labelledby');
        const label =
          textOf(byFor) ||
          textOf(element.closest('label')) ||
          element.getAttribute('aria-label') ||
          (labelledBy ? labelledBy.split(/\s+/).map(id => textOf(document.getElementById(id))).join(' ') : '') ||
          element.getAttribute('placeholder') ||
          textOf(element.closest('fieldset')?.querySelector('legend')) ||
          element.getAttribute('name') ||
          '';
        const type = element.tagName === 'INPUT' ? ((element as HTMLInputElement).type || 'text').toLowerCase() : element.tagName.toLowerCase();
        const checkable = type === 'checkbox' || type === 'radio';
        return {
          id: String(index),
          tag: element.tagName.toLowerCase() as 'input' | 'textarea' | 'select',
          type,
          label: label.slice(0, 300),
          required: element.required || element.getAttribute('aria-required') === 'true',
          hasValue: checkable ? (element as HTMLInputElement).checked : type === 'file' ? ((element as HTMLInputElement).files?.length ?? 0) > 0 : element.value.trim() !== '',
          options: element.tagName === 'SELECT' ? Array.from((element as HTMLSelectElement).options).map(option => option.text.trim()) : [],
        };
      });
  }, scope);
}

/** Sets a value the way a user would, so React/Vue-controlled inputs register it. */
async function setValue(handle: ElementHandle, value: string): Promise<void> {
  await handle.evaluate((element, next) => {
    const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, next);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }, value);
}

/**
 * Fills a form from approved data only. Consent checkboxes and radios are
 * never ticked on the user's behalf, and a required field nothing approved
 * can answer is reported, not guessed.
 */
export async function fillForm(page: Page, scope: string, data: ApplicantData, resumePath: string): Promise<FormFillOutcome> {
  const outcome: FormFillOutcome = { filled: [], missingRequired: [], captcha: await hasCaptcha(page), resumeUploaded: false, fileInputs: 0 };
  const fields = await collectFields(page, scope);

  for (const field of fields) {
    const handle = await page.$(`[data-rb-id="${field.id}"]`);
    if (!handle) continue;
    const kind = classifyField(field.label, field.type);

    if (field.type === 'file') {
      outcome.fileInputs++;
      if (kind === 'resume' && !outcome.resumeUploaded) {
        await (handle as ElementHandle<HTMLInputElement>).uploadFile(resumePath);
        outcome.resumeUploaded = true;
        outcome.filled.push({ label: field.label, kind });
      } else if (field.required && !field.hasValue) {
        outcome.missingRequired.push(field.label || 'file upload');
      }
      continue;
    }
    if (field.type === 'checkbox' || field.type === 'radio') {
      if (field.required && !field.hasValue) outcome.missingRequired.push(field.label || field.type);
      continue;
    }
    if (field.hasValue) continue;

    const value = valueFor(kind, field.label, data);
    if (field.tag === 'select') {
      const option = value ? field.options.find(text => text.toLowerCase() === value.toLowerCase()) ?? field.options.find(text => text.toLowerCase().includes(value.toLowerCase())) : undefined;
      if (option) {
        const optionValue = await handle.evaluate((element, text) => Array.from((element as HTMLSelectElement).options).find(o => o.text.trim() === text)?.value ?? '', option);
        await setValue(handle, optionValue);
        outcome.filled.push({ label: field.label, kind });
      } else if (field.required) {
        outcome.missingRequired.push(field.label || 'selection');
      }
      continue;
    }
    if (value) {
      await setValue(handle, value);
      outcome.filled.push({ label: field.label, kind });
    } else if (field.required) {
      outcome.missingRequired.push(field.label || field.type);
    }
  }
  return outcome;
}

const SUBMIT_TEXT = /^(submit( application)?|apply( now)?|send( application)?)$/i;

export async function clickSubmit(page: Page, scope: string): Promise<boolean> {
  const clicked = await page.evaluate(
    (scopeSelector, pattern) => {
      const root = document.querySelector(scopeSelector) ?? document.body;
      const regex = new RegExp(pattern, 'i');
      const candidates = Array.from(root.querySelectorAll<HTMLElement>('button, input[type=submit]'));
      const button =
        candidates.find(element => (element as HTMLButtonElement).type === 'submit' && element.getClientRects().length > 0) ??
        candidates.find(element => regex.test((element.textContent || (element as HTMLInputElement).value || '').trim()));
      if (!button) return false;
      button.click();
      return true;
    },
    scope,
    SUBMIT_TEXT.source,
  );
  if (!clicked) return false;
  await Promise.race([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => undefined), new Promise(resolve => setTimeout(resolve, 6000))]);
  return true;
}

const CONFIRMATION = /thank you for (applying|your application)|application (was |has been )?(submitted|received|sent)|we('|’)ve received your application|your application is on its way/i;

export async function looksSubmitted(page: Page): Promise<boolean> {
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  return CONFIRMATION.test(text);
}

export async function screenshot(page: Page): Promise<Buffer | undefined> {
  try {
    return Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
  } catch {
    return undefined;
  }
}
