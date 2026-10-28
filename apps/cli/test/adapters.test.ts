import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  addGraduate,
  fakeLlamaCommand,
  openEngineStore,
  recorded,
  standInAdapter,
  startFakeOllama,
  storeBase,
} from '@architect/engine/testing';
import { RunResultSchema } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { appRuntimeSettings } from '../src/runtime-settings';
import { cleanUp, cli, tempDir, testEnv } from './support';

afterEach(cleanUp);

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("the command's own llama-server", () => {
  it("follows the app's settings file the way the app does", async () => {
    const dataDir = await tempDir('settings');
    expect(appRuntimeSettings(dataDir, 16)).toEqual({ ollamaUrl: 'http://127.0.0.1:11434' });

    await writeFile(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        quietLocalModels: true,
        llamaServerPath: 'C:\\llama.cpp\\llama-server.exe',
        defaultStudent: {
          runtime: 'ollama',
          baseUrl: 'http://127.0.0.1:11500',
          model: 'muse-glimmer:30b',
          contextLength: 16384,
        },
      }),
    );
    expect(appRuntimeSettings(dataDir, 16)).toEqual({
      llamaServerPath: 'C:\\llama.cpp\\llama-server.exe',
      threads: 4,
      ollamaUrl: 'http://127.0.0.1:11500',
    });

    // An Ollama on another computer holds no GPU here, and a broken field falls back.
    await writeFile(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        quietLocalModels: 'yes',
        llamaServerPath: '',
        defaultStudent: {
          runtime: 'ollama',
          baseUrl: 'http://192.168.1.20:11434',
          model: 'muse-glimmer:30b',
          contextLength: 16384,
        },
      }),
    );
    expect(appRuntimeSettings(dataDir, 16)).toEqual({});
  });

  it('serves a version with an adapter, and stops llama-server when the run ends', async () => {
    const env = await testEnv();
    const dataDir = env['ARCHITECT_USER_DATA'] ?? '';
    await mkdir(dataDir, { recursive: true });
    const models = await tempDir('ollama-models');
    const base = storeBase(models);
    const ollama = await startFakeOllama([]);
    const record = join(dataDir, 'llama-server.jsonl');
    const store = openEngineStore(join(dataDir, 'architect.db'));
    try {
      await addGraduate(dataDir, store, {
        id: 'grd_adapter',
        baseUrl: ollama.url,
        adapter: { bytes: standInAdapter(base.header), baseDigest: base.digest, scale: 0.6 },
      });
    } finally {
      store.close();
    }
    // The app's settings name this computer's Ollama, which is asked to let go of the GPU first.
    await writeFile(
      join(dataDir, 'settings.json'),
      JSON.stringify({
        defaultStudent: {
          runtime: 'ollama',
          baseUrl: ollama.url,
          model: 'muse-glimmer:30b',
          contextLength: 16384,
        },
      }),
    );
    const request = join(dataDir, 'request.json');
    await writeFile(
      request,
      JSON.stringify({ format: 'architect.run-request/1', task: 'Which invoices are open?' }),
    );
    const previous = process.env['OLLAMA_MODELS'];
    process.env['OLLAMA_MODELS'] = models;
    try {
      const run = await cli(['run', 'service-desk', '--input', request, '--non-interactive'], {
        env,
        llamaServerCommand: fakeLlamaCommand(record),
      });
      expect(run.code, run.stderr).toBe(0);
      expect(RunResultSchema.parse(JSON.parse(run.stdout))).toMatchObject({
        status: 'succeeded',
        answer: 'lora=[{"id":0,"scale":0.6}]',
      });
    } finally {
      if (previous === undefined) delete process.env['OLLAMA_MODELS'];
      else process.env['OLLAMA_MODELS'] = previous;
      await ollama.close();
    }
    // llama-server ran in the command's own folder, and didn't outlive the command.
    const [started] = recorded(record).filter((entry) => entry.kind === 'start');
    expect(started?.pid).toBeDefined();
    expect(isRunning(started?.pid ?? 0)).toBe(false);
    expect(new Set(ollama.requests.map((entry) => entry.path))).toEqual(new Set(['/api/ps']));
  }, 60_000);
});
