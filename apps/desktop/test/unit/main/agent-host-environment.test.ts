import { describe, expect, it } from 'vitest';
import { agentHostEnvironment } from '../../../src/main/workspace/environment';

describe('agentHostEnvironment', () => {
  it('keeps what a process needs and drops proxies, credentials and NODE_OPTIONS', () => {
    const environment = agentHostEnvironment({
      PATH: '/usr/bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      HOME: '/home/jake',
      LANG: 'en_US.UTF-8',
      HTTP_PROXY: 'http://proxy.example:8080',
      https_proxy: 'http://proxy.example:8080',
      NO_PROXY: 'localhost',
      NODE_USE_ENV_PROXY: '1',
      MODEL_API_KEY: 'sk-meta',
      OPENAI_API_KEY: 'sk-openai',
      GITHUB_TOKEN: 'ghp_x',
      AWS_SECRET_ACCESS_KEY: 'aws',
      DB_PASSWORD: 'hunter2',
      GOOGLE_APPLICATION_CREDENTIALS: '/keys.json',
      NODE_OPTIONS: '--require ./preload.js',
    });
    expect(environment).toEqual({
      PATH: '/usr/bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      HOME: '/home/jake',
      LANG: 'en_US.UTF-8',
    });
  });
});
