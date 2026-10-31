import { describe, expect, it } from 'vitest';
import { LocalEndpointSchema, loopbackEndpointIssue, StudentConfigSchema } from '../src';

describe('a model server on this computer', () => {
  it.each([
    'http://127.0.0.1:8000/v1',
    'http://localhost:11434/v1',
    'http://[::1]:8080/v1',
    'https://127.0.0.2:8443',
  ])('accepts %s', (url) => {
    expect(loopbackEndpointIssue(url)).toBeNull();
  });

  it.each([
    ['https://api.together.xyz/v1', /not on this computer/],
    ['http://192.168.1.20:8000/v1', /not on this computer/],
    ['http://0.0.0.0:8000/v1', /not on this computer/],
    ['http://localhost.example.com:8000/v1', /not on this computer/],
    ['http://127.0.0.1/v1', /port/],
    ['ftp://127.0.0.1:21/v1', /http/],
    ['not a url', /URL/],
  ])('refuses %s with a reason', (url, reason) => {
    expect(loopbackEndpointIssue(url)).toMatch(reason);
  });

  it('parses an endpoint with its default context and refuses a remote one', () => {
    expect(
      LocalEndpointSchema.parse({
        baseUrl: ' http://127.0.0.1:8000/v1 ',
        model: 'academy-desk-ft',
      }),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'academy-desk-ft',
      contextLength: 16_384,
    });
    const remote = LocalEndpointSchema.safeParse({ baseUrl: 'http://10.0.0.4:8000', model: 'm' });
    expect(remote.success).toBe(false);
    expect(
      LocalEndpointSchema.safeParse({ baseUrl: 'http://localhost:1', model: ' ' }).success,
    ).toBe(false);
  });

  it('keeps the student a graduate runs on at an address on this computer', () => {
    const student = (baseUrl: string) =>
      StudentConfigSchema.safeParse({
        label: 'Academy desk',
        local: { runtime: 'openai_compatible', baseUrl, model: 'academy-desk-ft' },
      });
    expect(student('http://127.0.0.1:8000/v1').success).toBe(true);
    const remote = student('https://api.together.xyz/v1');
    expect(remote.success).toBe(false);
    expect(remote.error?.issues[0]?.path).toEqual(['local', 'baseUrl']);
  });
});
