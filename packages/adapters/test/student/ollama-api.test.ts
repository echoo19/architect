import { AdapterError, type PullProgress } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { listOllamaModels, ollamaVersion, pullOllamaModel } from '../../src/student/ollama-api';
import {
  sendJson,
  startServer,
  stopServers,
  whenClosed,
  writeInPieces,
  type Handler,
} from '../helpers/server';
import { fakeOllama, ndjson, sendNdjson } from '../helpers/student';

afterEach(stopServers);

async function failure(promise: Promise<unknown>): Promise<AdapterError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AdapterError);
  return error as AdapterError;
}

describe('ollamaVersion', () => {
  it('returns the server version', async () => {
    const server = await startServer(fakeOllama({ version: '0.34.4' }));
    expect(await ollamaVersion(server.url)).toBe('0.34.4');
  });

  it('fails with a network error when Ollama is not running', async () => {
    const server = await startServer(fakeOllama());
    await stopServers();
    const error = await failure(ollamaVersion(server.url));
    expect(error.code).toBe('network');
    expect(error.message).toContain("Couldn't connect to Ollama.");
  });

  it('fails when whatever answers is not Ollama', async () => {
    const server = await startServer((_request, res) => sendJson(res, 200, { hello: 'world' }));
    expect((await failure(ollamaVersion(server.url))).code).toBe('bad_response');
  });

  it('stops at the signal', async () => {
    const server = await startServer(fakeOllama());
    expect((await failure(ollamaVersion(server.url, AbortSignal.abort()))).code).toBe('aborted');
  });
});

describe('listOllamaModels', () => {
  it('lists the downloaded models in the shape the setup screen uses', async () => {
    const server = await startServer(
      fakeOllama({
        models: [
          { name: 'a:latest', size: 100, digest: 'sha256:aaa' },
          { name: 'b:30b', size: 200, digest: 'sha256:bbb' },
        ],
      }),
    );
    expect(await listOllamaModels(server.url)).toEqual([
      { name: 'a:latest', sizeBytes: 100, digest: 'sha256:aaa' },
      { name: 'b:30b', sizeBytes: 200, digest: 'sha256:bbb' },
    ]);
  });

  it('returns an empty list for a fresh install', async () => {
    const server = await startServer(fakeOllama());
    expect(await listOllamaModels(server.url)).toEqual([]);
  });
});

describe('pullOllamaModel', () => {
  const layerLine = (digest: string, total: number, completed: number) => ({
    status: `pulling ${digest.slice(0, 12)}`,
    digest,
    total,
    completed,
  });

  async function pull(
    pullHandler: Handler,
  ): Promise<{ progress: PullProgress[]; error?: AdapterError; requests: string[] }> {
    const server = await startServer(fakeOllama({ pull: pullHandler }));
    const progress: PullProgress[] = [];
    try {
      await pullOllamaModel(server.url, 'tiny:1b', (update) => progress.push(update));
      return { progress, requests: server.requests.map((request) => request.body) };
    } catch (error) {
      return {
        progress,
        error: error as AdapterError,
        requests: server.requests.map((request) => request.body),
      };
    }
  }

  it('asks Ollama to pull the model with streaming on', async () => {
    const { requests } = await pull((_request, res) => sendNdjson(res, { status: 'success' }));
    expect(JSON.parse(requests[0] ?? '{}')).toEqual({ model: 'tiny:1b', stream: true });
  });

  it('reports progress in plain words, with bytes totalled across every layer', async () => {
    const { progress, error } = await pull((_request, res) =>
      sendNdjson(
        res,
        { status: 'pulling manifest' },
        layerLine('sha256:aaaaaaaaaaaaaaaa', 1000, 0),
        layerLine('sha256:aaaaaaaaaaaaaaaa', 1000, 400),
        layerLine('sha256:aaaaaaaaaaaaaaaa', 1000, 1000),
        layerLine('sha256:bbbbbbbbbbbbbbbb', 50, 10),
        { status: 'verifying sha256 digest' },
        { status: 'writing manifest' },
        { status: 'success' },
      ),
    );

    expect(error).toBeUndefined();
    expect(progress).toEqual([
      { model: 'tiny:1b', status: 'Preparing the download', done: false },
      { model: 'tiny:1b', status: 'Downloading', done: false, completedBytes: 0, totalBytes: 1000 },
      {
        model: 'tiny:1b',
        status: 'Downloading',
        done: false,
        completedBytes: 400,
        totalBytes: 1000,
      },
      {
        model: 'tiny:1b',
        status: 'Downloading',
        done: false,
        completedBytes: 1000,
        totalBytes: 1000,
      },
      {
        model: 'tiny:1b',
        status: 'Downloading',
        done: false,
        completedBytes: 1010,
        totalBytes: 1050,
      },
      {
        model: 'tiny:1b',
        status: 'Checking the download',
        done: false,
        completedBytes: 1010,
        totalBytes: 1050,
      },
      {
        model: 'tiny:1b',
        status: 'Finishing',
        done: false,
        completedBytes: 1010,
        totalBytes: 1050,
      },
      { model: 'tiny:1b', status: 'Done', done: true, completedBytes: 1010, totalBytes: 1050 },
    ]);
  });

  it('resolves only after the success line', async () => {
    const { progress, error } = await pull((_request, res) =>
      sendNdjson(res, { status: 'pulling manifest' }),
    );
    expect(error?.code).toBe('network');
    expect(progress.some((update) => update.done)).toBe(false);
  });

  it('reads progress lines that arrive split across chunks', async () => {
    const lines = ndjson(
      { status: 'pulling manifest' },
      layerLine('sha256:aaaaaaaaaaaaaaaa', 100, 50),
      { status: 'success' },
    );
    const { progress, error } = await pull(async (_request, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const pieces: string[] = [];
      for (let i = 0; i < lines.length; i += 11) pieces.push(lines.slice(i, i + 11));
      await writeInPieces(res, pieces);
      res.end();
    });
    expect(error).toBeUndefined();
    expect(progress.at(-1)).toMatchObject({
      status: 'Done',
      done: true,
      completedBytes: 50,
      totalBytes: 100,
    });
  });

  it('says so when the model is not in the library', async () => {
    const { error } = await pull((_request, res) =>
      sendNdjson(
        res,
        { status: 'pulling manifest' },
        { error: 'pull model manifest: file does not exist' },
      ),
    );
    expect(error?.code).toBe('not_found');
    expect(error?.message).toContain('Ollama has no model called "tiny:1b" in its library.');
  });

  it('reports other failures with what Ollama said and what to check', async () => {
    const { error } = await pull((_request, res) =>
      sendNdjson(res, { error: 'write /models/blob: no space left on device' }),
    );
    expect(error?.code).toBe('server');
    expect(error?.message).toContain('no space left on device');
    expect(error?.message).toContain('free disk space');
  });

  it('reports an unknown model that Ollama rejects with an HTTP error', async () => {
    const { error } = await pull((_request, res) => sendJson(res, 404, { error: 'not found' }));
    expect(error?.code).toBe('not_found');
    expect(error?.message).toContain('Check the spelling of the model name.');
  });

  it('stops when the signal aborts, and drops the connection', async () => {
    let closed: Promise<void> = Promise.resolve();
    const server = await startServer(
      fakeOllama({
        pull: (_request, res) => {
          closed = whenClosed(res);
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.write(ndjson({ status: 'pulling manifest' }));
        },
      }),
    );
    const controller = new AbortController();
    const error = await failure(
      pullOllamaModel(server.url, 'tiny:1b', () => controller.abort(), controller.signal),
    );
    expect(error.code).toBe('aborted');
    await closed;
  });

  it('stops pulling when the progress callback throws', async () => {
    let closed: Promise<void> = Promise.resolve();
    const server = await startServer(
      fakeOllama({
        pull: (_request, res) => {
          closed = whenClosed(res);
          res.writeHead(200, { 'content-type': 'application/x-ndjson' });
          res.write(ndjson({ status: 'pulling manifest' }));
        },
      }),
    );
    await expect(
      pullOllamaModel(server.url, 'tiny:1b', () => {
        throw new Error('window closed');
      }),
    ).rejects.toThrow('window closed');
    await closed;
  });
});
