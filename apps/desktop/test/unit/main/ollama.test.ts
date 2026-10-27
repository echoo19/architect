import type { ServerResponse } from 'node:http';
import { OLLAMA_BASE_URL, type PullProgress } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelPulls } from '../../../src/main/ollama/pulls';
import { ollamaBaseUrl, ollamaStatus } from '../../../src/main/ollama/status';
import { closedUrl, fakeServer, sendJson, type FakeServer } from './http';

const servers: FakeServer[] = [];

async function ollama(pull?: (response: ServerResponse) => void): Promise<string> {
  const server = await fakeServer((request, response) => {
    if (request.url === '/api/version') return sendJson(response, { version: '0.33.1' });
    if (request.url === '/api/tags') {
      return sendJson(response, {
        models: [{ name: 'muse-glimmer:30b', size: 18_000_000_000, digest: 'sha256:abc' }],
      });
    }
    if (request.url === '/api/pull' && pull) return pull(response);
    sendJson(response, { error: 'not found' }, 404);
  });
  servers.push(server);
  return server.url;
}

function lines(response: ServerResponse, ...entries: object[]): void {
  response.writeHead(200, { 'content-type': 'application/x-ndjson' });
  for (const entry of entries) response.write(`${JSON.stringify(entry)}\n`);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('ollamaStatus', () => {
  it('reports the version and the downloaded models', async () => {
    expect(await ollamaStatus(await ollama())).toEqual({
      running: true,
      version: '0.33.1',
      models: [{ name: 'muse-glimmer:30b', sizeBytes: 18_000_000_000, digest: 'sha256:abc' }],
    });
  });

  it('answers "not running" when nothing listens', async () => {
    expect(await ollamaStatus(await closedUrl())).toEqual({ running: false, models: [] });
  });

  it('fails when something answers that is not Ollama', async () => {
    const server = await fakeServer((_request, response) => sendJson(response, { ok: 1 }, 500));
    servers.push(server);
    await expect(ollamaStatus(server.url)).rejects.toThrow();
  });

  it("uses the default student's server only when it runs on Ollama", () => {
    expect(
      ollamaBaseUrl({
        runtime: 'ollama',
        baseUrl: 'http://127.0.0.1:11500',
        model: 'muse-glimmer:30b',
        contextLength: 16_384,
      }),
    ).toBe('http://127.0.0.1:11500');
    expect(
      ollamaBaseUrl({
        runtime: 'openai_compatible',
        baseUrl: 'https://api.together.ai/v1',
        model: 'meta-models/Muse-Glimmer-30B',
        contextLength: 16_384,
      }),
    ).toBe(OLLAMA_BASE_URL);
  });
});

describe('ModelPulls', () => {
  it('reports progress until the model is ready', async () => {
    const url = await ollama((response) => {
      lines(
        response,
        { status: 'pulling manifest' },
        { status: 'pulling abc', digest: 'sha256:abc', total: 100, completed: 40 },
        { status: 'success' },
      );
      response.end();
    });
    const progress: PullProgress[] = [];
    await new ModelPulls((update) => progress.push(update)).pull(url, 'muse-glimmer:30b');
    expect(progress.map((update) => update.status)).toEqual([
      'Preparing the download',
      'Downloading',
      'Done',
    ]);
    expect(progress[1]).toMatchObject({ completedBytes: 40, totalBytes: 100, done: false });
    expect(progress.at(-1)?.done).toBe(true);
  });

  it('runs one download at a time and cancels it when asked', async () => {
    const url = await ollama((response) => lines(response, { status: 'pulling manifest' }));
    const progress: PullProgress[] = [];
    const pulls = new ModelPulls((update) => progress.push(update));
    const first = pulls.pull(url, 'muse-glimmer:30b');
    first.catch(() => undefined);

    await expect(pulls.pull(url, 'other:7b')).rejects.toThrow(
      "muse-glimmer:30b is still downloading. Try again when it's done.",
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    pulls.cancel();
    await expect(first).rejects.toThrow('cancelled');
    expect(progress.at(-1)).toMatchObject({ model: 'muse-glimmer:30b', done: true });
    expect(progress.at(-1)?.error).toContain('cancelled');
  });

  it('reports a failed download as its last progress', async () => {
    const url = await ollama((response) => {
      lines(response, { error: 'pull model manifest: file does not exist' });
      response.end();
    });
    const progress: PullProgress[] = [];
    await expect(
      new ModelPulls((update) => progress.push(update)).pull(url, 'no-such-model'),
    ).rejects.toThrow('Ollama has no model called "no-such-model"');
    expect(progress).toEqual([
      expect.objectContaining({ model: 'no-such-model', done: true, error: expect.any(String) }),
    ]);
  });
});
