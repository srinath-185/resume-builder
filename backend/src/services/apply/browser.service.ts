import { BindingScope, injectable } from '@loopback/core';
import { existsSync } from 'fs';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { envInt, envList, envString } from '../../common/config/env.util';
import { AppConfigurationError } from '../../common/errors';
import { Semaphore } from '../../common/utils/semaphore.util';

const CANDIDATE_PATHS = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

export function findChrome(): string | undefined {
  const configured = envString('CHROME_PATH');
  if (configured) return configured;
  return CANDIDATE_PATHS.find(path => existsSync(path));
}

/**
 * One shared headless Chrome (puppeteer-core with the system browser), one
 * isolated incognito context per apply so cookies never leak between users,
 * and a concurrency cap because each page costs ~100–200 MB.
 */
@injectable({ scope: BindingScope.SINGLETON })
export class BrowserService {
  private browser?: Browser;
  private readonly gate = new Semaphore(Math.max(1, envInt('APPLY_CONCURRENCY', 1)));

  isAvailable(): boolean {
    return findChrome() !== undefined;
  }

  async withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
    return this.gate.run(async () => {
      const browser = await this.launch();
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.setDefaultTimeout(envInt('APPLY_STEP_TIMEOUT_MS', 30_000));
      page.setDefaultNavigationTimeout(envInt('APPLY_NAVIGATION_TIMEOUT_MS', 45_000));
      await page.setViewport({ width: 1280, height: 1600 });
      try {
        return await task(page);
      } finally {
        await context.close().catch(() => undefined);
      }
    });
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
  }

  private async launch(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    const executablePath = findChrome();
    if (!executablePath) throw new AppConfigurationError('No Chrome/Chromium found; set CHROME_PATH');
    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', ...envList('CHROME_ARGS')],
    });
    return this.browser;
  }
}
