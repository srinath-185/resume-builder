import { AuthenticationComponent, registerAuthenticationStrategy } from '@loopback/authentication';
import { BootMixin } from '@loopback/boot';
import { ApplicationConfig } from '@loopback/core';
import { RepositoryMixin } from '@loopback/repository';
import { RestApplication, RestBindings } from '@loopback/rest';
import { RestExplorerBindings, RestExplorerComponent } from '@loopback/rest-explorer';
import { JwtAuthenticationStrategy } from './authentication/jwt.strategy';
import { envList } from './common/config/env.util';
import { AppRejectProvider } from './providers/app-reject.provider';
import { registerCrons } from './setup/crons';
import { registerProcessors } from './setup/processors';
import { registerServices } from './setup/services';

export { ApplicationConfig };

export const API_BASE_PATH = '/api';

export class ResumeBuilderApplication extends BootMixin(RepositoryMixin(RestApplication)) {
  constructor(options: ApplicationConfig = {}) {
    super({
      ...options,
      rest: {
        ...options.rest,
        cors: {
          origin: envList('CORS_ORIGIN', ['http://localhost:5300']),
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          maxAge: 86400,
        },
        requestBodyParser: { json: { limit: '1mb' } },
      },
    });

    this.basePath(API_BASE_PATH);
    this.bind(RestBindings.SequenceActions.REJECT).toProvider(AppRejectProvider);

    this.configure(RestExplorerBindings.COMPONENT).to({ path: '/explorer' });
    this.component(RestExplorerComponent);

    this.component(AuthenticationComponent);
    registerAuthenticationStrategy(this, JwtAuthenticationStrategy);

    registerServices(this);
    registerProcessors(this);
    registerCrons(this);

    this.projectRoot = __dirname;
    this.bootOptions = {
      controllers: { dirs: ['controllers'], extensions: ['.controller.js'], nested: true },
      repositories: { dirs: ['repositories'], extensions: ['.repository.js'], nested: true },
      datasources: { dirs: ['datasources'], extensions: ['.datasource.js'], nested: true },
      observers: { dirs: ['observers'], extensions: ['.observer.js'], nested: true },
      interceptors: { dirs: ['interceptors'], extensions: ['.interceptor.js'], nested: true },
    };
  }
}
