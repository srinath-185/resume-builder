import { Client, createRestAppClient, givenHttpServerConfig } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { QueueService } from '../../queue/queue.service';

export interface AppWithClient {
  app: ResumeBuilderApplication;
  client: Client;
}

/**
 * Boots the real application against an in-memory datasource. Each call gets a
 * fresh database, so specs do not share state.
 */
export async function setupApplication(configure?: (app: ResumeBuilderApplication) => void): Promise<AppWithClient> {
  const app = new ResumeBuilderApplication({ rest: givenHttpServerConfig() });
  app.bind('datasources.config.mongo').to({ name: 'mongo', connector: 'memory' });
  configure?.(app);
  await app.boot();
  await app.start();
  return { app, client: createRestAppClient(app) };
}

export async function drainQueues(app: ResumeBuilderApplication): Promise<void> {
  const queue = await app.get<QueueService>('services.QueueService');
  await queue.drain();
}
