import {
  glimmerBuild,
  type AppSettings,
  type LlamaServerStatus,
  type LocalRuntimes,
  type ModelEntry,
  type PullProgress,
} from '@architect/shared';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { GPU_12GB, LLAMA_SERVER_READY, LOCAL_WITH_GLIMMER, OLLAMA_READY } from './fixtures';

/*
 * Settings › Models and the mentor and model steps of first-run setup, against a stand-in for
 * main's connection handlers. Nothing here reaches a provider, opens a browser or loads a model.
 */

const GPU_BUILD = glimmerBuild('glimmer-gpu');
const GRANITE = 'granite4.2:8b';

const LOCAL: LocalRuntimes = {
  ...LOCAL_WITH_GLIMMER,
  ollama: {
    ...LOCAL_WITH_GLIMMER.ollama,
    models: [...LOCAL_WITH_GLIMMER.ollama.models, { id: GRANITE, sizeBytes: 5_200_000_000 }],
  },
};

/** What each hosted provider's own list says, by provider. */
const LISTS: Record<string, ModelEntry[]> = {
  openrouter: [
    {
      id: 'maker/some-model',
      label: 'Maker: Some Model',
      pricing: { inputPerM: 0.5, cachedInputPerM: 0.05, outputPerM: 2 },
    },
  ],
  meta: [{ id: 'muse-spark-1.3' }],
  openai: [{ id: 'gpt-6-luna' }],
};

interface Seed {
  secrets: Record<string, boolean>;
  local: LocalRuntimes;
  /** What the llama.cpp row finds; ready on PATH when absent. */
  llamaServer?: LlamaServerStatus;
}

interface FakeConnections {
  calls: { channel: string; args: unknown[] }[];
  broadcast: (channel: string, payload: unknown) => void;
}

/**
 * Answers the connection channels from a seed and keeps the saved keys in step with what the
 * page adds. Keys sent to `connections.add` and `secrets.set` are never recorded.
 */
async function installFakeConnections(app: ElectronApplication, seed: Seed): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow, ipcMain }, { seed, lists, llamaServer }) => {
      const calls: { channel: string; args: unknown[] }[] = [];
      const secrets = { ...seed.secrets };
      const handle = (channel: string, reply: (...args: never[]) => unknown) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
          const [first] = args;
          const recorded =
            channel === 'secrets:set'
              ? args.slice(0, 1)
              : channel === 'connections:add' && first && typeof first === 'object'
                ? [{ ...first, key: 'key' in first ? '(a key)' : undefined }]
                : args;
          calls.push({ channel, args: recorded });
          try {
            return { ok: true, value: await reply(...(args as never[])) };
          } catch (error) {
            return {
              ok: false,
              error: { message: error instanceof Error ? error.message : 'Failed' },
            };
          }
        });
      };
      const broadcast = (channel: string, payload: unknown) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(channel, payload);
        }
      };

      handle('graduates:list', () => []);
      handle('jobs:list', () => []);
      handle('secrets:status', () => ({ ...secrets }));
      handle('secrets:set', (ref: string) => {
        secrets[ref] = true;
      });
      handle('connections:detectLocal', () => seed.local);
      handle(
        'connections:listModels',
        (source: { provider: string }) => lists[source.provider] ?? [],
      );
      handle('connections:add', (request: { provider: string; key?: string }) => {
        if (request.key === 'refused-key') {
          throw new Error('OpenAI refused that key. Check it and try again.');
        }
        secrets[request.provider] = true;
        return { secretRef: request.provider, models: lists[request.provider]?.length ?? 0 };
      });
      handle('connections:remove', (source: { provider: string }) => {
        secrets[source.provider] = false;
      });
      handle('connections:signIn', () => {
        secrets.openrouter = true;
        return { status: 'signed_in' };
      });
      handle('connections:cancelSignIn', () => undefined);
      handle('connections:testMentor', (config: { model: string }) => ({
        ok: true,
        latencyMs: 412,
        detail: config.model,
      }));
      handle('app:openProviderPage', () => undefined);
      handle('ollama:install', () => new Promise<void>(() => undefined));
      handle('connections:llamaServer', () => llamaServer);

      Object.assign(globalThis, { fakeConnections: { calls, broadcast } });
    },
    { seed, lists: LISTS, llamaServer: seed.llamaServer ?? LLAMA_SERVER_READY },
  );
}

function callsTo(app: ElectronApplication, channel: string): Promise<unknown[][]> {
  return app.evaluate(
    (_electron, channel) =>
      (globalThis as unknown as { fakeConnections: FakeConnections }).fakeConnections.calls
        .filter((call) => call.channel === channel)
        .map((call) => call.args),
    channel,
  );
}

async function emitPullProgress(app: ElectronApplication, progress: PullProgress): Promise<void> {
  await app.evaluate((_electron, progress) => {
    (globalThis as unknown as { fakeConnections: FakeConnections }).fakeConnections.broadcast(
      'ollama:onPullProgress',
      progress,
    );
  }, progress);
}

function settings(page: Page): Promise<AppSettings> {
  return page.evaluate(() => window.architect.settings.get());
}

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;
let defaults: AppSettings;

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  defaults = await settings(page);
});

test.afterAll(async () => {
  await launched?.close();
});

/** A fresh stand-in, the default models, then the app reloaded at `path`. */
async function open(path: string, seed: Seed, onboarded = true): Promise<void> {
  await installFakeConnections(launched.app, seed);
  await updateSettings(page, {
    onboarded,
    defaultMentor: defaults.defaultMentor,
    defaultStudent: defaults.defaultStudent,
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

async function openModelsTab(): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Models' }).click();
  await settle(page);
}

test('lists every connection and picks the mentor from any of them', async () => {
  await open('/', { secrets: { meta: true, openrouter: true }, local: LOCAL });
  await openModelsTab();
  const connections = page.getByRole('region', { name: 'Connections' });
  // The runtimes on this computer wait under Advanced, which opens when Ollama is down.
  await expect(connections.getByText('Running · 0.12.6 · 2 models')).toBeHidden();
  await connections.getByRole('button', { name: 'Advanced' }).click();
  await expect(connections.getByText('Running · 0.12.6 · 2 models')).toBeVisible();
  await expect(connections.getByText('Not found')).toBeVisible();
  await expect(connections.getByText('Build 10472 · on PATH')).toBeVisible();

  await page.getByRole('button', { name: 'Teacher', exact: true }).click();
  const menu = page.getByRole('listbox');
  await expect(menu.getByRole('option', { name: /Muse Spark 1\.3/ }).first()).toBeVisible();
  const listed = menu.getByRole('option', { name: /Some Model/ });
  await expect(listed).toContainText('$0.5 · $2');
  await expect(menu.getByRole('option', { name: new RegExp(GRANITE) })).toBeVisible();
  // Providers without a key are offered by their presets.
  await expect(menu.getByText('Needs a key').first()).toBeVisible();
  await listed.click();
  await expect
    .poll(async () => (await settings(page)).defaultMentor)
    .toMatchObject({
      kind: 'model',
      provider: 'openrouter',
      model: 'maker/some-model',
      secretRef: 'openrouter',
      pricing: { inputPerM: 0.5, outputPerM: 2 },
    });
  expect(await callsTo(launched.app, 'connections:listModels')).toContainEqual([
    { provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', secretRef: 'openrouter' },
  ]);

  // A model chosen by its id has no listed price, so the page asks for one.
  await page.getByRole('button', { name: 'Teacher', exact: true }).click();
  await page.getByPlaceholder('Search models').fill('maker/unlisted');
  await page
    .getByRole('option', { name: /maker\/unlisted/ })
    .filter({ hasText: 'OpenRouter' })
    .click();
  await page.getByLabel('Dollars per million input tokens').fill('1');
  await page.getByLabel('Dollars per million output tokens').fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await settings(page)).defaultMentor)
    .toMatchObject({
      model: 'maker/unlisted',
      pricing: { inputPerM: 1, cachedInputPerM: 1, outputPerM: 4 },
    });

  // A preset from a provider with no key yet asks for its key.
  await page.getByRole('button', { name: 'Teacher', exact: true }).click();
  await page.getByRole('option', { name: /Claude Haiku/ }).click();
  await expect(page.getByLabel('Anthropic API key')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('picks the model for new agents on this computer, with whether it fits the GPU', async () => {
  await open('/', { secrets: { meta: true }, local: LOCAL });
  await openModelsTab();
  await page.getByRole('button', { name: 'Model for new agents' }).click();
  const menu = page.getByRole('listbox');
  await expect(menu.getByRole('option', { name: /Muse Glimmer · 2-bit/ })).toContainText('Fast');
  await expect(menu.getByRole('option', { name: /Muse Glimmer · 4-bit/ })).toContainText(
    'Not downloaded',
  );
  await menu.getByRole('option', { name: new RegExp(GRANITE) }).click();
  await expect.poll(async () => (await settings(page)).defaultStudent.model).toBe(GRANITE);

  // The 4-bit build would run partly on this 12 GB card; the 2-bit one fits and is here.
  await page.getByRole('button', { name: 'Model for new agents' }).click();
  await page.getByRole('option', { name: /Muse Glimmer · 4-bit/ }).click();
  await expect(page.getByText('Not downloaded yet')).toBeVisible();
  await expect(
    page.getByText(`Runs entirely on the ${GPU_12GB.name}, several times faster`),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Use it' }).click();
  await expect.poll(async () => (await settings(page)).defaultStudent.model).toBe(GPU_BUILD.model);
  await page.keyboard.press('Escape');
});

test('shows a llama-server too old for Glimmer as too old, with how to fix it', async () => {
  const tooOld: LlamaServerStatus = {
    source: 'path',
    path: '/usr/local/bin/llama-server',
    build: 9000,
    ready: false,
    problem: 'llama-server is build 9000, older than 10358, the first that runs Muse Glimmer.',
    hint: 'Update llama.cpp to build 10358 or newer.',
    minimumBuild: 10358,
  };
  await open('/', { secrets: { meta: true }, local: LOCAL, llamaServer: tooOld });
  await openModelsTab();
  const connections = page.getByRole('region', { name: 'Connections' });
  await connections.getByRole('button', { name: 'Advanced' }).click();
  await expect(connections.getByText('Too old', { exact: true })).toBeVisible();
  // One plain sentence leads; the engine's words, which say what to do, wait under Details.
  await expect(connections.getByRole('alert')).toContainText(
    'Build 9000 is too old. Build 10358 or newer is needed.',
  );
  await connections.getByRole('button', { name: 'Details' }).click();
  await expect(connections).toContainText('Update llama.cpp to build 10358 or newer.');
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect.poll(() => callsTo(launched.app, 'connections:llamaServer')).toHaveLength(2);
  await page.keyboard.press('Escape');
});

test('adds a key its provider accepts, and says why when one is refused', async () => {
  await open('/', { secrets: { meta: true }, local: OLLAMA_READY });
  await openModelsTab();
  await page.getByRole('button', { name: 'Add API key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an API key' });
  await dialog.getByLabel('API key').fill('refused-key');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'OpenAI refused that key. Check it and try again.',
  );
  await dialog.getByLabel('API key').fill('a-key-that-works');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  const connections = page.getByRole('region', { name: 'Connections' });
  await expect(connections.getByText('OpenAI', { exact: true })).toBeVisible();
  expect(await callsTo(launched.app, 'connections:add')).toEqual([
    [{ provider: 'openai', key: '(a key)' }],
    [{ provider: 'openai', key: '(a key)' }],
  ]);
  await page.keyboard.press('Escape');
});

test('signs in with OpenRouter through main, without a browser here', async () => {
  await open('/', { secrets: { meta: true }, local: OLLAMA_READY });
  await openModelsTab();
  await page.getByRole('button', { name: 'Sign in with OpenRouter' }).click();
  const connections = page.getByRole('region', { name: 'Connections' });
  await expect(connections.getByText('OpenRouter', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with OpenRouter' })).toBeHidden();
  expect(await callsTo(launched.app, 'connections:signIn')).toEqual([['openrouter']]);
  expect(await callsTo(launched.app, 'app:openProviderPage')).toEqual([]);
  await page.keyboard.press('Escape');
});

test('offers Spark first and three other ways to a teacher in setup, and a model here needs no key', async () => {
  await open('/welcome', { secrets: {}, local: LOCAL }, false);
  await expect(page.getByRole('heading', { name: 'Welcome to Architect' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: "Your agent's model" })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a teacher' })).toBeVisible();
  // Spark with a Meta key comes first; the other ways wait behind one line.
  await expect(page.getByLabel('Meta API key')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByRole('button', { name: 'Other ways to connect a teacher' }).click();
  for (const name of [/^Spark/, /OpenRouter/, /Another service/, /On this computer/]) {
    await expect(page.getByRole('radio', { name })).toBeVisible();
  }
  // Nothing to continue with yet: skipping says what that costs.
  const next = page.getByRole('button', { name: 'Continue' });
  await expect(next).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
  await expect(page.getByText('You can connect one later in Settings.')).toBeVisible();

  await page.getByRole('radio', { name: /On this computer/ }).click();
  await page.getByRole('button', { name: 'Teacher', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(GRANITE) }).click();
  await expect(next).toBeEnabled();
  await page.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(page.getByText('Connected · 412 ms')).toBeVisible();
  const [[tested]] = (await callsTo(launched.app, 'connections:testMentor')) as [[object]];
  expect(tested).toMatchObject({ provider: 'ollama', model: GRANITE });
  expect(tested).not.toHaveProperty('secretRef');

  // OpenRouter's way signs in first, then offers its models.
  await page.getByRole('radio', { name: /OpenRouter/ }).click();
  await expect(next).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Teacher', exact: true }).click();
  await page.getByRole('option', { name: /Some Model/ }).click();
  await expect(next).toBeEnabled();
});

test('sizes Glimmer for the GPU in setup and installs the GPU-sized build', async () => {
  await open('/welcome', { secrets: {}, local: { ...OLLAMA_READY, gpu: GPU_12GB } }, false);
  await page.getByRole('button', { name: 'Continue' }).click();
  const recommended = page.getByRole('radio', { name: /Recommended/ });
  const larger = page.getByRole('radio', { name: /Larger/ });
  // The build that fits this card is chosen while the default isn't downloaded.
  await expect(recommended).toHaveAttribute('aria-checked', 'true');
  await expect(recommended).toContainText('Runs on your graphics card');
  await expect(recommended).toContainText('14 GB download · Lighter, but less accurate');
  await expect(larger).toContainText('Part runs on the processor');
  await expect(larger).toContainText('17 GB download · Most accurate');
  await expect.poll(async () => (await settings(page)).defaultStudent.model).toBe(GPU_BUILD.model);

  await page.getByRole('button', { name: /^Download Glimmer ·/ }).click();
  await expect.poll(() => callsTo(launched.app, 'ollama:install')).toEqual([['glimmer-gpu']]);
  await emitPullProgress(launched.app, {
    model: GPU_BUILD.model,
    status: 'Preparing it for your GPU',
    done: false,
  });
  await expect(page.getByText('Preparing it for your GPU').first()).toBeVisible();
  await expect(larger).toBeDisabled();
});
