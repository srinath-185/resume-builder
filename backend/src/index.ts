import 'dotenv/config';
import { ApplicationConfig, ResumeBuilderApplication } from './application';
import { envInt, envString } from './common/config/env.util';

export * from './application';

export async function main(options: ApplicationConfig = {}): Promise<ResumeBuilderApplication> {
  const app = new ResumeBuilderApplication(options);
  await app.boot();
  await app.start();
  console.log(`Resume Builder API listening at ${app.restServer.url}`);
  return app;
}

if (require.main === module) {
  const config: ApplicationConfig = {
    rest: {
      port: envInt('PORT', 6969),
      host: envString('HOST', '127.0.0.1'),
      gracePeriodForClose: 5000,
      openApiSpec: { setServersFromRequest: true },
    },
    shutdown: { signals: ['SIGTERM', 'SIGINT'] },
  };
  main(config).catch(error => {
    console.error('Cannot start the application.', error);
    process.exit(1);
  });
}
