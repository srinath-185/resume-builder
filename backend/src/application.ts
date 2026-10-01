import { AuthenticationComponent, registerAuthenticationStrategy } from '@loopback/authentication';
import { BootMixin } from '@loopback/boot';
import { ApplicationConfig } from '@loopback/core';
import { RepositoryMixin } from '@loopback/repository';
import { RestApplication, RestBindings } from '@loopback/rest';
import { RestExplorerBindings, RestExplorerComponent } from '@loopback/rest-explorer';
import { AdminJwtAuthenticationStrategy, JwtAuthenticationStrategy, SuperadminJwtAuthenticationStrategy } from './authentication/jwt.strategy';
import { envBool, envList, envString } from './common/config/env.util';
import { AppRejectProvider } from './providers/app-reject.provider';
import { registerCrons } from './setup/crons';
import { registerProcessors } from './setup/processors';
import { registerServices } from './setup/services';

export { ApplicationConfig };

export const API_BASE_PATH = '/api';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Express `trust proxy`: unset means the socket address is the client (so
 * X-Forwarded-For cannot be spoofed to dodge rate limits). Behind a reverse
 * proxy set TRUST_PROXY to the hop count (e.g. 1) or the proxy's subnet.
 */
export function trustProxySetting(): boolean | number | string {
  const raw = envString('TRUST_PROXY');
  if (raw === undefined || raw === 'false') return false;
  if (raw === 'true') return true;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

export class ResumeBuilderApplication extends BootMixin(RepositoryMixin(RestApplication)) {
  constructor(options: ApplicationConfig = {}) {
    // The explorer and the OpenAPI document describe every route; production keeps them off unless asked for.
    const explorer = envBool('API_EXPLORER', !isProduction());
    super({
      ...options,
      rest: {
        ...options.rest,
        // Without this LoopBack redirects /explorer to the hosted explorer.loopback.io.
        apiExplorer: { disabled: !explorer },
        openApiSpec: { ...options.rest?.openApiSpec, disabled: !explorer },
        cors: {
          origin: envList('CORS_ORIGIN', ['http://localhost:5300']),
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          maxAge: 86400,
        },
        requestBodyParser: { json: { limit: '1mb' } },
        expressSettings: { 'trust proxy': trustProxySetting(), 'x-powered-by': false },
      },
    });

    this.basePath(API_BASE_PATH);
    this.bind(RestBindings.SequenceActions.REJECT).toProvider(AppRejectProvider);

    this.middleware(async (context, next) => {
      const { response } = context;
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Referrer-Policy', 'no-referrer');
      if (isProduction()) {
        response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      }
      return next();
    });

    if (explorer) {
      this.configure(RestExplorerBindings.COMPONENT).to({ path: '/explorer' });
      this.component(RestExplorerComponent);
    }

    this.component(AuthenticationComponent);
    registerAuthenticationStrategy(this, JwtAuthenticationStrategy);
    registerAuthenticationStrategy(this, AdminJwtAuthenticationStrategy);
    registerAuthenticationStrategy(this, SuperadminJwtAuthenticationStrategy);

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
