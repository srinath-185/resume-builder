import { inject, lifeCycleObserver, LifeCycleObserver } from '@loopback/core';
import { BrowserService } from '../services/apply/browser.service';

/** Closes the shared headless Chrome on shutdown so no browser process outlives the API. */
@lifeCycleObserver('browser')
export class BrowserObserver implements LifeCycleObserver {
  constructor(@inject('services.BrowserService') private browser: BrowserService) {}

  async stop(): Promise<void> {
    await this.browser.close();
  }
}
