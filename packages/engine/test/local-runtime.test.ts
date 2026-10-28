import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlamaCppStudent } from '@architect/adapters';
import { AdapterError, DecodingSchema, type StudentStreamEvent } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeGguf, parseGgufHeader, bufferSource, standInLoraSpec } from '../src/gguf';
import {
  checkServerVersion,
  describeLlamaServer,
  findFreePort,
  findLlamaServer,
  freeGpuFromOllama,
  LlamaServer,
  LocalAdapterRuntime,
  LocalRuntimeError,
  parseOllamaName,
  parseServerVersion,
  resolveOllamaModel,
  serverArgs,
  type LlamaServerLaunch,
  type ServerCommand,
} from '../src/local-runtime';
import { READ_TOOL } from './support/episodes';
import { tinyBaseSpec } from './support/gguf';
import { writeOllamaStore } from './support/ollama-store';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-llama-server.ts');

let dir: string;
const servers: LlamaServer[] = [];
const runtimes: LocalAdapterRuntime[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-local-runtime-'));
});
afterEach(async () => {
  await Promise.all([...servers.splice(0), ...runtimes.splice(0)].map((server) => server.stop()));
  rmSync(dir, { recursive: true, force: true });
});

function fakeCommand(record: string, ...fake: string[]): ServerCommand {
  return {
    file: process.execPath,
    args: ['--import', 'tsx', FAKE, '--fake-record', record, ...fake],
  };
}

interface Recorded {
  kind: 'start' | 'chat';
  pid?: number;
  argv?: string[];
  llamaEnv?: string[];
  body?: Record<string, unknown>;
}

function recorded(record: string): Recorded[] {
  if (!existsSync(record)) return [];
  return readFileSync(record, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Recorded);
}

const starts = (record: string) => recorded(record).filter((entry) => entry.kind === 'start');

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await pause(25);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function launchFor(
  record: string,
  overrides: Partial<LlamaServerLaunch> = {},
  ...fake: string[]
): LlamaServerLaunch {
  return {
    command: fakeCommand(record, ...fake),
    modelPath: join(dir, 'base.gguf'),
    alias: 'muse-glimmer:30b-iq2',
    adapters: [],
    contextSize: 16_384,
    gpuLayers: 999,
    ...overrides,
  };
}

function server(options: Partial<ConstructorParameters<typeof LlamaServer>[0]> = {}): LlamaServer {
  const created = new LlamaServer({ runtimeDir: join(dir, 'runtime'), ...options });
  servers.push(created);
  return created;
}

describe('finding llama-server', () => {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

  function program(folder: string): string {
    mkdirSync(folder, { recursive: true });
    const file = join(folder, name);
    writeFileSync(file, '');
    chmodSync(file, 0o755);
    return file;
  }

  it('uses the path set in Settings, whether it names the program or its folder', () => {
    const file = program(join(dir, 'llama.cpp'));
    expect(findLlamaServer({ configured: file, env: {} })).toEqual({
      command: { file, args: [] },
      source: 'setting',
    });
    expect(findLlamaServer({ configured: join(dir, 'llama.cpp'), env: {} }).command.file).toBe(
      file,
    );
  });

  it('otherwise takes the first one on PATH, however the platform spells it', () => {
    const second = program(join(dir, 'second'));
    program(join(dir, 'third'));
    const separator = process.platform === 'win32' ? ';' : ':';
    const path = [join(dir, 'first'), join(dir, 'second'), join(dir, 'third')].join(separator);
    const env = process.platform === 'win32' ? { Path: path } : { PATH: path };
    expect(findLlamaServer({ env })).toEqual({
      command: { file: second, args: [] },
      source: 'path',
    });
  });

  it('says where it looked and what to do when there is none', () => {
    const missing = () => findLlamaServer({ configured: join(dir, 'nowhere', name), env: {} });
    expect(missing).toThrow(LocalRuntimeError);
    expect(missing).toThrow(/The llama-server set in Settings isn't at/);
    try {
      findLlamaServer({ env: { PATH: join(dir, 'empty') } });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'binary_not_found',
        hint: expect.stringContaining('build 10358 or newer') as unknown,
      });
    }
  });

  it('says for Settings where it is, its build, and what to do when it is missing or too old', async () => {
    const record = join(dir, 'status.jsonl');
    await expect(describeLlamaServer({ command: fakeCommand(record) })).resolves.toEqual({
      source: 'setting',
      path: process.execPath,
      build: 10472,
      ready: true,
      minimumBuild: 10358,
    });
    await expect(
      describeLlamaServer({ command: fakeCommand(record, '--fake-build', '9000') }),
    ).resolves.toEqual({
      source: 'setting',
      path: process.execPath,
      build: 9000,
      ready: false,
      problem: 'llama-server is build 9000, older than 10358, the first that runs Muse Glimmer.',
      hint: 'Update llama.cpp to build 10358 or newer.',
      minimumBuild: 10358,
    });
    await expect(describeLlamaServer({ env: {} })).resolves.toEqual({
      source: null,
      ready: false,
      problem: "llama-server isn't installed, or isn't on PATH.",
      hint: 'Install llama.cpp (build 10358 or newer), then choose its llama-server in Settings or add its folder to PATH.',
      minimumBuild: 10358,
    });
    await expect(
      describeLlamaServer({ configured: join(dir, 'nowhere'), env: {} }),
    ).resolves.toMatchObject({
      source: null,
      ready: false,
      problem: expect.stringContaining("The llama-server set in Settings isn't at") as unknown,
    });
    // A file that isn't a program that runs is found, and said not to work.
    const file = program(join(dir, 'broken'));
    await expect(describeLlamaServer({ configured: file, env: {} })).resolves.toMatchObject({
      source: 'setting',
      path: file,
      ready: false,
      problem: expect.any(String) as unknown,
    });
    expect(starts(record)).toEqual([]);
  });

  it('reads the build and refuses one too old for Glimmer', async () => {
    expect(parseServerVersion('version: 10472 (60eeeb6)\nbuilt with MSVC')).toEqual({
      build: 10472,
      commit: '60eeeb6',
    });
    expect(parseServerVersion('nothing here')).toBeNull();
    const record = join(dir, 'version.jsonl');
    await expect(checkServerVersion(fakeCommand(record))).resolves.toEqual({
      build: 10472,
      commit: '60eeeb6',
    });
    await expect(
      checkServerVersion(fakeCommand(record, '--fake-build', '9000')),
    ).rejects.toMatchObject({
      code: 'binary_unusable',
      message: 'llama-server is build 9000, older than 10358, the first that runs Muse Glimmer.',
    });
  });
});

describe("finding a model's GGUF in Ollama's store", () => {
  const gguf = encodeGguf(tinyBaseSpec({ blocks: 1, vocabulary: 4 }));

  it('reads both manifest layouts and names from other hosts', () => {
    const models = join(dir, 'models');
    writeOllamaStore(models, [
      { path: ['ollama.com', 'library', 'muse-glimmer', '30b-iq2'], layout: 'v2', weights: gguf },
      {
        path: ['registry.ollama.ai', 'library', 'muse-glimmer', '30b'],
        layout: 'v1',
        weights: Buffer.concat([gguf, Buffer.from('4-bit')]),
        extraLayers: [
          { mediaType: 'application/vnd.ollama.image.projector', content: Buffer.from('mmproj') },
        ],
      },
      {
        path: ['hf.co', 'unsloth', 'Muse-Glimmer-30B-GGUF', 'UD-IQ2_XXS'],
        layout: 'v1',
        weights: gguf,
      },
    ]);
    const store = { configured: models };

    const twoBit = resolveOllamaModel('muse-glimmer:30b-iq2', store);
    expect(twoBit.modelPath).toBe(join(models, 'blobs', twoBit.digest.replace(':', '-')));
    expect(twoBit).toMatchObject({ sizeBytes: gguf.length, projectorPath: null });
    expect(twoBit.manifestPath).toContain('manifests-v2');

    const fourBit = resolveOllamaModel('muse-glimmer:30b', store);
    expect(fourBit.manifestPath).toContain(join('manifests', 'registry.ollama.ai'));
    expect(fourBit.projectorPath).not.toBeNull();

    const pulled = resolveOllamaModel('hf.co/unsloth/Muse-Glimmer-30B-GGUF:UD-IQ2_XXS', store);
    expect(pulled.digest).toBe(twoBit.digest);
  });

  it('looks in OLLAMA_MODELS, then the home folder, when Settings names none', () => {
    const fromEnv = join(dir, 'env-models');
    writeOllamaStore(fromEnv, [
      { path: ['ollama.com', 'library', 'glimmer', 'latest'], layout: 'v2', weights: gguf },
    ]);
    expect(resolveOllamaModel('glimmer', { env: { OLLAMA_MODELS: fromEnv } }).sizeBytes).toBe(
      gguf.length,
    );
    const home = join(dir, 'home');
    writeOllamaStore(join(home, '.ollama', 'models'), [
      { path: ['ollama.com', 'library', 'glimmer', 'latest'], layout: 'v2', weights: gguf },
    ]);
    expect(resolveOllamaModel('glimmer:latest', { env: {}, home }).sizeBytes).toBe(gguf.length);
  });

  it('refuses a name that could leave the store, and files that are not whole', () => {
    expect(parseOllamaName('../../secrets')).toBeNull();
    expect(parseOllamaName('a/b/c/d')).toBeNull();
    expect(parseOllamaName('muse-glimmer:30b-iq2')).toEqual({
      host: null,
      namespace: 'library',
      model: 'muse-glimmer',
      tag: '30b-iq2',
    });
    const models = join(dir, 'models');
    writeOllamaStore(models, [
      {
        path: ['ollama.com', 'library', 'short', 'latest'],
        layout: 'v2',
        weights: gguf,
        recordedSize: gguf.length + 1,
      },
      {
        path: ['ollama.com', 'library', 'text', 'latest'],
        layout: 'v2',
        weights: Buffer.from('not a model at all'),
      },
      {
        path: ['ollama.com', 'library', 'adapted', 'latest'],
        layout: 'v2',
        weights: gguf,
        extraLayers: [
          { mediaType: 'application/vnd.ollama.image.adapter', content: Buffer.from('lora') },
        ],
      },
      {
        path: ['ollama.com', 'library', 'safetensors', 'latest'],
        layout: 'v2',
        weights: gguf,
        format: 'safetensors',
      },
    ]);
    const store = { configured: models };
    const failure = (name: string) => {
      try {
        resolveOllamaModel(name, store);
      } catch (error) {
        return error instanceof LocalRuntimeError
          ? `${error.code}: ${error.message}`
          : String(error);
      }
      return 'resolved';
    };
    expect(failure('../../secrets')).toBe(
      `model_not_found: "../../secrets" isn't a model name Ollama uses.`,
    );
    expect(failure('missing')).toMatch(/^model_not_found: missing isn't in Ollama's model folder/);
    expect(failure('short')).toMatch(
      /^model_unusable: The weights of short are \d+ bytes; Ollama recorded \d+\.$/,
    );
    expect(failure('text')).toBe("model_unusable: The weights of text aren't a GGUF file.");
    expect(failure('adapted')).toMatch(
      /^model_unusable: adapted has an adapter built into Ollama's copy/,
    );
    expect(failure('safetensors')).toMatch(/is stored as safetensors, not GGUF/);
  });
});

describe('the llama-server process', () => {
  it('starts on 127.0.0.1 with the flags it needs, and only answers to its key', async () => {
    const record = join(dir, 'record.jsonl');
    process.env['LLAMA_ARG_PORT'] = '1';
    const freed: string[] = [];
    const llama = server({
      beforeStart: async () => {
        freed.push(starts(record).length === 0 ? 'before the server' : 'after the server');
      },
    });
    const launch = launchFor(record, {
      adapters: [join(dir, 'candidate.gguf'), join(dir, 'incumbent.gguf')],
      threads: 3,
    });
    let running;
    try {
      running = await llama.ensure(launch);
    } finally {
      delete process.env['LLAMA_ARG_PORT'];
    }

    expect(freed).toEqual(['before the server']);
    const [start] = starts(record);
    const argv = start?.argv ?? [];
    const port = Number(flag(argv, '--port'));
    expect(running.url).toBe(`http://127.0.0.1:${port}`);
    expect(flag(argv, '--host')).toBe('127.0.0.1');
    expect(flag(argv, '--model')).toBe(launch.modelPath);
    expect(flag(argv, '--n-gpu-layers')).toBe('999');
    expect(flag(argv, '--ctx-size')).toBe('16384');
    expect(flag(argv, '--parallel')).toBe('1');
    expect(flag(argv, '--threads')).toBe('3');
    expect(flag(argv, '--threads-batch')).toBe('3');
    expect(argv).toEqual(
      expect.arrayContaining(['--jinja', '--no-webui', '--offline', '--lora-init-without-apply']),
    );
    expect(argv.filter((_, index) => argv[index - 1] === '--lora')).toEqual(launch.adapters);
    expect(Number(flag(argv, '--sleep-idle-seconds'))).toBeGreaterThan(600);
    expect(start?.llamaEnv).toEqual([]);
    expect(argv.join(' ')).not.toContain(running.apiKey);

    const anonymous = await fetch(`${running.url}/lora-adapters`);
    expect(anonymous.status).toBe(401);
    const listed = await fetch(`${running.url}/lora-adapters`, {
      headers: { authorization: `Bearer ${running.apiKey}` },
    });
    expect(await listed.json()).toEqual([
      { id: 0, path: launch.adapters[0], scale: 0 },
      { id: 1, path: launch.adapters[1], scale: 0 },
    ]);
    expect(llama.status()).toMatchObject({ state: 'ready', port, pid: start?.pid });
    expect(readFileSync(llama.status().logFile ?? '', 'utf8')).toContain('server is listening');
    expect(JSON.parse(readFileSync(join(dir, 'runtime', 'server.json'), 'utf8'))).toMatchObject({
      pid: start?.pid,
      port,
    });

    // The same launch reuses the process; the server never starts twice for it.
    expect(await llama.ensure(launch)).toBe(running);
    expect(starts(record)).toHaveLength(1);

    await llama.stop();
    expect(llama.status().state).toBe('stopped');
    expect(existsSync(join(dir, 'runtime', 'server.json'))).toBe(false);
    await until(() => !alive(start?.pid ?? 0));
  });

  it('stops after it has been idle, but never under a request in flight', async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server({ idleStopMs: 300 });
    await llama.ensure(launchFor(record));
    const release = llama.hold();
    await pause(600);
    expect(llama.status().state).toBe('ready');
    release();
    await until(() => llama.status().state === 'stopped');
    const pid = starts(record)[0]?.pid ?? 0;
    await until(() => !alive(pid));
  });

  it('restarts for a new thread cap only when no request is in flight', async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server();
    await llama.ensure(launchFor(record, { threads: 3 }));
    const release = llama.hold();
    await expect(llama.ensure(launchFor(record, { threads: 6 }))).rejects.toMatchObject({
      code: 'busy',
    });
    release();
    await llama.ensure(launchFor(record, { threads: 6 }));
    expect(starts(record).map((entry) => flag(entry.argv ?? [], '--threads'))).toEqual(['3', '6']);
  });

  it('names what went wrong when the server fails to start', async () => {
    const outcome = async (
      mode: string,
      options: Partial<ConstructorParameters<typeof LlamaServer>[0]> = {},
    ) => {
      const llama = server(options);
      const record = join(dir, `${mode}.jsonl`);
      try {
        await llama.ensure(
          launchFor(record, { adapters: [join(dir, 'a.gguf')] }, '--fake-mode', mode),
        );
        return 'started';
      } catch (error) {
        expect(llama.status().state).toBe('stopped');
        return error instanceof LocalRuntimeError ? error.code : String(error);
      }
    };
    expect(await outcome('crash')).toBe('model_unusable');
    expect(await outcome('oom')).toBe('out_of_memory');
    expect(await outcome('bad-lora')).toBe('adapter_unusable');
    expect(await outcome('drop-lora')).toBe('adapter_unusable');
    expect(await outcome('never-ready', { startupTimeoutMs: 1500 })).toBe('start_failed');
    const neverReady = starts(join(dir, 'never-ready.jsonl'))[0]?.pid ?? 0;
    await until(() => !alive(neverReady));
  });

  it('tries another port when the one it picked was taken', async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server();
    const running = await llama.ensure(launchFor(record, {}, '--fake-mode', 'port-taken-once'));
    const ports = starts(record).map((entry) => Number(flag(entry.argv ?? [], '--port')));
    expect(ports).toHaveLength(2);
    expect(running.url).toBe(`http://127.0.0.1:${ports[1]}`);
  });

  it('stops a server a crashed app left running before starting its own', async () => {
    const record = join(dir, 'record.jsonl');
    const crashed = new LlamaServer({ runtimeDir: join(dir, 'runtime') });
    await crashed.ensure(launchFor(record));
    const orphan = starts(record)[0]?.pid ?? 0;
    expect(alive(orphan)).toBe(true);

    // The app restarts: a new manager over the same folder, which knows nothing of the process.
    const restarted = server();
    await restarted.ensure(launchFor(record));
    await until(() => !alive(orphan));
    expect(starts(record)).toHaveLength(2);
    expect(restarted.status().state).toBe('ready');
  });

  it('notices when the server dies on its own, and starts it again on the next request', async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server();
    await llama.ensure(launchFor(record));
    process.kill(starts(record)[0]?.pid ?? 0);
    await until(() => llama.status().state === 'stopped');
    expect(llama.status().lastError).toMatch(/stopped on its own/);
    await llama.ensure(launchFor(record));
    expect(starts(record)).toHaveLength(2);
  });

  it('holds the server in the same step that hands it over, so another launch waits its turn', async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server();
    const [first, second] = await Promise.allSettled([
      llama.acquire(launchFor(record, { threads: 3 })),
      llama.acquire(launchFor(record, { threads: 6 })),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'busy' } });
    const lease = first.status === 'fulfilled' ? first.value : null;
    expect(llama.status().state).toBe('ready');
    const answer = await fetch(`${lease?.server.url}/lora-adapters`, {
      headers: { authorization: `Bearer ${lease?.server.apiKey}` },
    });
    expect(answer.status).toBe(200);
    lease?.release();
    expect(starts(record)).toHaveLength(1);
  });

  it('forgets the idle timer of a server that died, so it never stops the next one', async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server({ idleStopMs: 1500 });
    const armedAt = Date.now();
    await llama.ensure(launchFor(record));
    process.kill(starts(record)[0]?.pid ?? 0);
    await until(() => llama.status().state === 'stopped');
    // The second server is held, so only a timer left over from the first could stop it.
    const { release } = await llama.acquire(launchFor(record));
    await pause(Math.max(0, armedAt + 1800 - Date.now()));
    expect(llama.status().state).toBe('ready');
    release();
  });

  it('calls off a start under way when asked to stop', async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server({
      beforeStart: async () => {
        await pause(300);
      },
    });
    const starting = llama.ensure(launchFor(record));
    await pause(50);
    await llama.stop();
    await expect(starting).rejects.toMatchObject({ code: 'aborted' });
    expect(llama.status().state).toBe('stopped');
    expect(starts(record)).toEqual([]);
  });

  it("lets one caller give up waiting without calling off another's start", async () => {
    const record = join(dir, 'record.jsonl');
    const llama = server();
    const impatient = new AbortController();
    const first = llama.ensure(launchFor(record), impatient.signal);
    const second = llama.ensure(launchFor(record));
    impatient.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await expect(second).resolves.toMatchObject({
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) as unknown,
    });
    expect(llama.status().state).toBe('ready');
  });

  it('refuses an adapter path llama-server would split at a comma', async () => {
    const llama = server();
    const record = join(dir, 'record.jsonl');
    await expect(
      llama.ensure(launchFor(record, { adapters: [join(dir, 'a,b.gguf')] })),
    ).rejects.toMatchObject({ code: 'adapter_unusable' });
    expect(starts(record)).toEqual([]);
  });

  it('lists the flags the same way every time', () => {
    const launch = launchFor('record');
    expect(serverArgs(launch, 8089, 'key', 660)).toEqual([
      '--model',
      launch.modelPath,
      '--alias',
      'muse-glimmer:30b-iq2',
      '--host',
      '127.0.0.1',
      '--port',
      '8089',
      '--api-key-file',
      'key',
      '--jinja',
      '--n-gpu-layers',
      '999',
      '--ctx-size',
      '16384',
      '--parallel',
      '1',
      '--no-webui',
      '--offline',
      '--sleep-idle-seconds',
      '660',
    ]);
  });
});

describe('freeing the GPU from Ollama', () => {
  let ollama: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => (ollama ? ollama.close(() => resolve()) : resolve()));
    ollama = null;
  });

  it('asks Ollama to unload every model it holds and waits until it has', async () => {
    const loaded = new Set(['muse-glimmer:30b', 'qwen3.6:latest']);
    const requests: string[] = [];
    ollama = createServer((request, response) => {
      const parts: Buffer[] = [];
      request.on('data', (part: Buffer) => parts.push(part));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        if (request.url === '/api/ps') {
          response.end(
            JSON.stringify({
              models: [...loaded].map((name) => ({ name, model: name, size: 10, size_vram: 10 })),
            }),
          );
          return;
        }
        const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as {
          model: string;
          keep_alive: number;
        };
        requests.push(`${request.url} ${body.model} keep_alive=${body.keep_alive}`);
        // Ollama lets go a moment after it answers.
        setTimeout(() => loaded.delete(body.model), 100);
        response.end(JSON.stringify({ model: body.model, done: true, done_reason: 'unload' }));
      });
    });
    await new Promise<void>((resolve) => ollama?.listen(0, '127.0.0.1', resolve));
    const { port } = ollama.address() as AddressInfo;

    const unloaded = await freeGpuFromOllama({ baseUrl: `http://127.0.0.1:${port}`, pollMs: 50 });
    expect(unloaded).toEqual(['muse-glimmer:30b', 'qwen3.6:latest']);
    expect(requests).toEqual([
      '/api/chat muse-glimmer:30b keep_alive=0',
      '/api/chat qwen3.6:latest keep_alive=0',
    ]);
    expect(loaded.size).toBe(0);
  });

  it('has nothing to free when Ollama is not running', async () => {
    const port = await findFreePort();
    await expect(freeGpuFromOllama({ baseUrl: `http://127.0.0.1:${port}` })).resolves.toEqual([]);
  });
});

describe('serving a graduate with its adapter', () => {
  function setUp(options: { threads?: () => number | undefined } = {}) {
    const models = join(dir, 'models');
    const baseBytes = encodeGguf(tinyBaseSpec({ blocks: 2, vocabulary: 8 }));
    writeOllamaStore(models, [
      {
        path: ['ollama.com', 'library', 'muse-glimmer', '30b-iq2'],
        layout: 'v2',
        weights: baseBytes,
      },
    ]);
    const base = parseGgufHeader(bufferSource(baseBytes));
    const candidate = join(dir, 'candidate.gguf');
    writeFileSync(
      candidate,
      encodeGguf(standInLoraSpec(base, { modules: ['attn_q'], effect: 'perturb' })),
    );
    const incumbent = join(dir, 'incumbent.gguf');
    writeFileSync(
      incumbent,
      encodeGguf(standInLoraSpec(base, { modules: ['ffn_down'], effect: 'none' })),
    );
    const record = join(dir, 'record.jsonl');
    const freed: number[] = [];
    const runtime = new LocalAdapterRuntime({
      runtimeDir: join(dir, 'runtime'),
      ollamaModelsDir: () => models,
      command: fakeCommand(record),
      freeGpu: async () => {
        freed.push(Date.now());
      },
      ...(options.threads ? { threads: options.threads } : {}),
    });
    runtimes.push(runtime);
    const adapters = [
      { key: 'candidate', path: candidate },
      { key: 'incumbent', path: incumbent },
    ];
    const digest = `sha256:${createHash('sha256').update(baseBytes).digest('hex')}`;
    return { runtime, record, adapters, freed, base, digest };
  }

  const sha256Of = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

  it('refuses a base of another build and an adapter file that changed, before anything starts', async () => {
    const { runtime, record, adapters, digest } = setUp();
    const [candidate] = adapters;
    if (!candidate) throw new Error('No candidate.');
    const sha256 = sha256Of(candidate.path);
    const serve = (overrides: { baseDigest: string; sha256: string }) =>
      runtime.access({
        model: 'muse-glimmer:30b-iq2',
        adapters: [{ ...candidate, sha256: overrides.sha256 }],
        scales: { candidate: 1 },
        baseDigest: overrides.baseDigest,
      });
    const otherBuild = `sha256:${'b2'.repeat(32)}`;

    const wrongBase = await serve({ baseDigest: otherBuild, sha256 })
      .acquire()
      .catch((error: unknown) => error);
    // A student sees an adapter error, which stops an evaluation and says how to recover.
    expect(wrongBase).toBeInstanceOf(AdapterError);
    expect(wrongBase).toMatchObject({
      code: 'bad_request',
      cause: {
        code: 'base_mismatch',
        message: `muse-glimmer:30b-iq2 on this computer is another build (weights ${digest.slice(0, 19)}) than the one its adapter was trained on (sha256:b2b2b2b2b2b2).`,
        hint: `Install the build of muse-glimmer:30b-iq2 whose weights are ${otherBuild}, the exact base it was trained on, in place of this one.`,
      },
    });
    const changed = await serve({ baseDigest: digest, sha256: 'c3'.repeat(32) })
      .acquire()
      .catch((error: unknown) => error);
    expect(changed).toMatchObject({
      code: 'bad_request',
      cause: {
        code: 'adapter_unusable',
        message: `The adapter for candidate isn't the file it was installed with: its sha256 begins ${sha256.slice(0, 12)}, not c3c3c3c3c3c3.`,
      },
    });
    expect(starts(record)).toEqual([]);

    // The build it was trained on, with the file as installed, starts.
    (await serve({ baseDigest: digest, sha256 }).acquire()).release();
    expect(starts(record)).toHaveLength(1);
    // A file changed after it was served is caught at the next start.
    await runtime.stop();
    writeFileSync(candidate.path, Buffer.concat([readFileSync(candidate.path), Buffer.from([0])]));
    await expect(serve({ baseDigest: digest, sha256 }).acquire()).rejects.toMatchObject({
      cause: { code: 'adapter_unusable' },
    });
    expect(starts(record)).toHaveLength(1);
  });

  it('finds every problem at once, and loads nothing to find them', async () => {
    const record = join(dir, 'record.jsonl');
    const runtime = new LocalAdapterRuntime({
      runtimeDir: join(dir, 'runtime'),
      ollamaModelsDir: () => join(dir, 'no-models'),
      env: {},
      freeGpu: async () => undefined,
    });
    runtimes.push(runtime);
    const survey = await runtime.survey({
      model: 'muse-glimmer:30b-iq2',
      adapters: [{ key: 'v1', path: join(dir, 'missing.gguf'), sha256: 'd4'.repeat(32) }],
      scales: { v1: 1 },
      baseDigest: `sha256:${'e5'.repeat(32)}`,
    });
    expect(survey.server).toBeNull();
    expect(survey.base).toBeNull();
    expect(survey.problems.map((problem) => problem.code)).toEqual([
      'binary_not_found',
      'model_not_found',
      'adapter_unusable',
    ]);
    expect(starts(record)).toEqual([]);
  });

  it('reads the build of a stand-in like any llama-server, and refuses one too old', async () => {
    const { adapters, digest } = setUp();
    const record = join(dir, 'old.jsonl');
    const runtime = new LocalAdapterRuntime({
      runtimeDir: join(dir, 'old-runtime'),
      ollamaModelsDir: () => join(dir, 'models'),
      command: fakeCommand(record, '--fake-build', '9000'),
      freeGpu: async () => undefined,
    });
    runtimes.push(runtime);
    const survey = await runtime.survey({
      model: 'muse-glimmer:30b-iq2',
      adapters,
      scales: {},
      baseDigest: digest,
    });
    expect(survey.server).toBeNull();
    expect(survey.base?.digest).toBe(digest);
    expect(survey.problems).toMatchObject([
      {
        code: 'binary_unusable',
        message: 'llama-server is build 9000, older than 10358, the first that runs Muse Glimmer.',
        hint: 'Update llama.cpp to build 10358 or newer.',
      },
    ]);
    expect(starts(record)).toEqual([]);
  });

  it('shares one server between students and sets each one scale per request', async () => {
    const { runtime, record, adapters, freed } = setUp();
    const withCandidate = runtime.access({
      model: 'muse-glimmer:30b-iq2',
      adapters,
      scales: { candidate: 1 },
    });
    const baseOnly = runtime.access({ model: 'muse-glimmer:30b-iq2', adapters, scales: {} });

    const lease = await withCandidate.acquire();
    expect(lease.lora).toEqual([
      { id: 0, scale: 1 },
      { id: 1, scale: 0 },
    ]);
    const other = await baseOnly.acquire();
    expect(other.url).toBe(lease.url);
    expect(other.lora).toEqual([
      { id: 0, scale: 0 },
      { id: 1, scale: 0 },
    ]);
    expect(starts(record)).toHaveLength(1);
    expect(freed).toHaveLength(1);

    const reply = await fetch(`${lease.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${lease.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [], stream: true, lora: lease.lora }),
    });
    expect(await reply.text()).toContain(
      'lora=[{\\"id\\":0,\\"scale\\":1},{\\"id\\":1,\\"scale\\":0}]',
    );
    lease.release();
    other.release();

    await expect(withCandidate.describe()).resolves.toMatchObject({
      model: 'muse-glimmer:30b-iq2',
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) as unknown,
      contextLength: 16_384,
    });
  });

  it('lets a llama.cpp student run a turn through the server it starts, adapter and all', async () => {
    const { runtime, record, adapters } = setUp();
    const access = runtime.access({
      model: 'muse-glimmer:30b-iq2',
      adapters,
      scales: { candidate: 1 },
    });
    const student = createLlamaCppStudent(access);
    expect(student.isLocal).toBe(true);
    const events: StudentStreamEvent[] = [];
    const turn = student.chat({
      messages: [
        { role: 'system', content: 'You are the returns desk.' },
        { role: 'user', content: 'Was order 1182 late?' },
      ],
      tools: [READ_TOOL],
      decoding: DecodingSchema.parse({}),
      seed: 7,
    });
    for await (const event of turn) events.push(event);

    expect(events).toEqual([
      {
        type: 'tool_call',
        call: { id: 'call_fake_1', name: 'read', arguments: { path: 'data/orders.csv' } },
      },
      {
        type: 'done',
        usage: expect.objectContaining({
          inputTokens: 12,
          outputTokens: 7,
          reasoningTokens: 1,
        }) as unknown,
        finish: 'tool_calls',
      },
    ]);
    const [chat] = recorded(record).filter((entry) => entry.kind === 'chat');
    expect(chat?.body).toMatchObject({
      lora: [
        { id: 0, scale: 1 },
        { id: 1, scale: 0 },
      ],
      chat_template_kwargs: { reasoning_strength: 'low' },
      temperature: 1,
      top_p: 0.95,
      top_k: 64,
      seed: 7,
      stream: true,
    });
    expect(runtime.status().state).toBe('ready');
    await student.release();
    expect(runtime.status().state).toBe('stopped');
  });

  it('checks every adapter against the base before anything starts', async () => {
    const { runtime, record } = setUp();
    const otherBase = parseGgufHeader(bufferSource(encodeGguf(tinyBaseSpec({ blocks: 3 }))));
    const wrong = join(dir, 'wrong.gguf');
    writeFileSync(
      wrong,
      encodeGguf(standInLoraSpec(otherBase, { modules: ['attn_q'], effect: 'none' })),
    );
    const access = runtime.access({
      model: 'muse-glimmer:30b-iq2',
      adapters: [{ key: 'v2', path: wrong }],
      scales: { v2: 1 },
    });
    // A student sees an adapter error, which stops an evaluation instead of failing a task.
    const failure = await access.acquire().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdapterError);
    expect(failure).toMatchObject({
      code: 'bad_request',
      message: expect.stringMatching(
        /^The adapter for v2 doesn't fit muse-glimmer:30b-iq2: The base model has no blk\.2\.attn_q\.weight\. /,
      ) as unknown,
      cause: { code: 'adapter_unusable' },
    });
    await expect(access.check()).resolves.toMatchObject({ ok: false });
    expect(starts(record)).toEqual([]);
  });

  it('checks what loading needs without loading anything', async () => {
    const { runtime, record, adapters } = setUp();
    await expect(
      runtime.access({ model: 'muse-glimmer:30b-iq2', adapters, scales: {} }).check(),
    ).resolves.toMatchObject({
      ok: true,
      detail: 'llama-server build 10472 can run muse-glimmer:30b-iq2 with 2 adapters.',
    });
    await expect(
      runtime.access({ model: 'muse-glimmer:70b', adapters: [], scales: {} }).check(),
    ).resolves.toMatchObject({
      ok: false,
      hint: expect.stringContaining('Settings › Models') as unknown,
    });
    expect(starts(record)).toEqual([]);
    expect(() =>
      runtime.access({ model: 'muse-glimmer:30b-iq2', adapters, scales: { other: 1 } }),
    ).toThrow('No adapter is loaded as other.');
  });

  it('starts the server with the quiet-mode thread cap in force at the time', async () => {
    let threads: number | undefined = 3;
    const { runtime, record, adapters } = setUp({ threads: () => threads });
    const access = runtime.access({ model: 'muse-glimmer:30b-iq2', adapters, scales: {} });
    (await access.acquire()).release();
    threads = undefined;
    (await access.acquire()).release();
    expect(starts(record).map((entry) => flag(entry.argv ?? [], '--threads'))).toEqual([
      '3',
      undefined,
    ]);
  });

  it("stops the shared server when one student lets go only once the others' requests end", async () => {
    const { runtime, adapters } = setUp();
    const candidate = runtime.access({
      model: 'muse-glimmer:30b-iq2',
      adapters,
      scales: { candidate: 1 },
    });
    const base = runtime.access({ model: 'muse-glimmer:30b-iq2', adapters, scales: {} });
    const lease = await base.acquire();
    await candidate.stop();
    expect(runtime.status().state).toBe('ready');
    lease.release();
    await until(() => runtime.status().state === 'stopped');
  });
});
