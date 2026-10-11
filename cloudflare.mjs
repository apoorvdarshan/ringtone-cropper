import { Container } from '@cloudflare/containers';

export class YouTubeContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '60s';
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      BACKEND_TOKEN: env.BACKEND_TOKEN,
      PORT: '8080',
      NODE_ENV: 'production',
    };
  }
}

export { default } from './worker.mjs';
