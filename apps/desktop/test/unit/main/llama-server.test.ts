import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PickedPaths } from '../../../src/main/files/picked';
import { registerConnectionHandlers } from '../../../src/main/handlers/connections';
import { readLaunchOptions } from '../../../src/main/launch';
import type { SignIns } from '../../../src/main/oauth/sign-ins';
import { SettingsStore } from '../../../src/main/settings/store';
import { agentHostArgs } from '../../../src/main/workspace/process';
import { routerHarness } from './router-harness';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'architect-llama-setting-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const { router, call } = routerHarness();
  const settings = await SettingsStore.open(join(dir, 'settings.json'));
  const picked = new PickedPaths();
  registerConnectionHandlers(router, {
    keys: async () => undefined,
    secrets: { set: async () => undefined, clear: async () => undefined },
    settings,
    signIns: {} as SignIns,
    gpu: async () => null,
    picked,
  });
  return { call, settings, picked };
}

describe('the llama-server setting', () => {
  it('takes only a program the user picked, uses it, and goes back to PATH when cleared', async () => {
    const { call, settings, picked } = await setup();
    // No program here: nothing is run, so the check says where it looked.
    const program = join(dir, 'llama.cpp', 'llama-server.exe');

    const refused = await call('connections:chooseLlamaServer', program);
    expect(refused).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Architect only runs a program you choose.') },
    });
    expect(settings.get().llamaServerPath).toBeUndefined();

    picked.add([program], 'files');
    expect(await call('connections:chooseLlamaServer', program)).toEqual({
      ok: true,
      value: {
        source: null,
        ready: false,
        problem: `The llama-server set in Settings isn't at ${program}.`,
        hint: 'Choose the llama-server program from your llama.cpp folder in Settings, or clear the setting to use the one on PATH.',
        minimumBuild: 10358,
      },
    });
    expect(settings.get().llamaServerPath).toBe(program);
    expect(await call('connections:llamaServer')).toMatchObject({
      ok: true,
      value: { problem: `The llama-server set in Settings isn't at ${program}.` },
    });

    await call('connections:chooseLlamaServer', null);
    expect(settings.get().llamaServerPath).toBeUndefined();
    // Saved without it, so the next start finds the one on PATH.
    expect((await SettingsStore.open(join(dir, 'settings.json'))).get().llamaServerPath).toBe(
      undefined,
    );
  });

  it('refuses a path that is not text', async () => {
    const { call } = await setup();
    expect(await call('connections:chooseLlamaServer', 42)).toMatchObject({ ok: false });
  });
});

describe('a stand-in llama-server for tests', () => {
  const command = { file: 'C:\\node\\node.exe', args: ['--import', 'tsx', 'fake.ts'] };

  it('is read from ARCHITECT_LLAMA_SERVER_COMMAND, and refused when it is not a command', () => {
    expect(readLaunchOptions({}).llamaServerCommand).toBeUndefined();
    expect(
      readLaunchOptions({ ARCHITECT_LLAMA_SERVER_COMMAND: JSON.stringify(command) })
        .llamaServerCommand,
    ).toEqual(command);
    expect(() => readLaunchOptions({ ARCHITECT_LLAMA_SERVER_COMMAND: 'fake.ts' })).toThrow(
      'ARCHITECT_LLAMA_SERVER_COMMAND must be JSON',
    );
    expect(() =>
      readLaunchOptions({ ARCHITECT_LLAMA_SERVER_COMMAND: JSON.stringify({ file: '' }) }),
    ).toThrow();
  });

  it('reaches the agent host as an argument, and only when set', () => {
    const base = { dataDir: 'D:\\data', sandboxEntryPath: 'D:\\out\\sandbox\\child.mjs' };
    expect(agentHostArgs(base)).toEqual([
      '--data-dir',
      'D:\\data',
      '--sandbox-entry',
      'D:\\out\\sandbox\\child.mjs',
    ]);
    expect(agentHostArgs({ ...base, llamaServerCommand: command }).slice(-2)).toEqual([
      '--llama-server-command',
      JSON.stringify(command),
    ]);
  });
});
