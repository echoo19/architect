import { afterEach, describe, expect, it } from 'vitest';
import { createHttpClient } from '../../src/http/client';
import { describeMissingModel, probeModel } from '../../src/openai/models';
import { sendJson, startServer, stopServers } from '../helpers/server';

afterEach(stopServers);

async function clientReplying(status: number, body: unknown) {
  const server = await startServer((_req, res) => sendJson(res, status, body));
  return createHttpClient({ baseUrl: `${server.url}/v1`, service: 'Testhost' });
}

describe('probeModel', () => {
  it('finds a model in the standard list', async () => {
    const http = await clientReplying(200, { object: 'list', data: [{ id: 'a' }, { id: 'b' }] });
    expect(await probeModel(http, 'b')).toEqual({ kind: 'listed' });
  });

  it('reads a bare array, which some hosts send', async () => {
    const http = await clientReplying(200, [{ id: 'a' }, { id: 'b' }]);
    expect(await probeModel(http, 'a')).toEqual({ kind: 'listed' });
  });

  it('lists what is available when the model is not there', async () => {
    const http = await clientReplying(200, { data: [{ id: 'a' }, { id: 'b' }] });
    expect(await probeModel(http, 'c')).toEqual({ kind: 'missing', available: ['a', 'b'] });
  });

  it.each([404, 400, 405])('says the list is unavailable on HTTP %i', async (status) => {
    const http = await clientReplying(status, { error: 'no such route' });
    expect(await probeModel(http, 'a')).toEqual({ kind: 'unavailable' });
  });

  it('says the list is unavailable when the reply is not a model list', async () => {
    const http = await clientReplying(200, { hello: 'world' });
    expect(await probeModel(http, 'a')).toEqual({ kind: 'unavailable' });
  });

  it('raises real failures instead of hiding them', async () => {
    const http = await clientReplying(401, { error: { message: 'bad key' } });
    await expect(probeModel(http, 'a')).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('describeMissingModel', () => {
  it('suggests the undated id when the account lists that one', () => {
    expect(describeMissingModel('vendor/model-1026', ['vendor/model', 'other'])).toBe(
      'It lists "vendor/model" instead. Try that id.',
    );
  });

  it('does not guess at a sibling id, which could be a different data tier', () => {
    const hint = describeMissingModel('muse-spark-1.3', ['muse-spark-1.3-contributor', 'other']);
    expect(hint).toBe('It offers muse-spark-1.3-contributor, other.');
  });

  it('shows the first few models and counts the rest', () => {
    const available = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(describeMissingModel('x', available)).toBe('It offers a, b, c, d, e, and 2 more.');
  });

  it('says so when the list is empty', () => {
    expect(describeMissingModel('x', [])).toBe('Its model list is empty.');
  });
});
