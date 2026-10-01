import { get, response } from '@loopback/rest';

export class HealthController {
  @get('/health')
  @response(200, { description: 'Liveness probe' })
  health(): { status: 'ok'; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
