import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, type LaunchedApp } from './app';
import { EMPTY_ENGINE, LOCAL_WITH_GLIMMER, stubEngine } from './fixtures';
import { installExperimentsFake } from './fixtures-experiments';
import { recordedComparisonReport } from './recorded';

/*
 * Any model in every role (decision 093), against the stand-in engine: the Connections view on
 * Models, with a hosted API, a cluster's vLLM and SGLang servers and the runtimes here, each with
 * the roles it can fill; and an experiment designed on a field taught by other models than Spark
 * and Glimmer, every label naming them. Nothing here reaches a provider or a cluster.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const VLLM = 'http://gpu-node-7:8000/v1';
const SGLANG = 'http://dgx-02.lab:30000/v1';

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp({
    settings: {
      onboarded: true,
      edition: 'lab',
      customEndpoints: [
        { baseUrl: VLLM, label: 'gpu-node-7:8000' },
        { baseUrl: SGLANG, label: 'dgx-02.lab:30000' },
      ],
    },
  });
  page = launched.page;
  const visible = await launched.app.evaluate(({ BrowserWindow }, size) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(size.width, size.height);
    return main.isVisible();
  }, SIZE);
  expect(visible).toBe(false);
  await mkdir(OUT_DIR, { recursive: true });
  await stubEngine(launched.app, {
    ...EMPTY_ENGINE,
    'secrets:status': { openrouter: true, anthropic: true },
    'connections:detectLocal': LOCAL_WITH_GLIMMER,
    'connections:huggingFace': { source: null },
    'jobs:list': [
      {
        id: 'returns-desk',
        name: 'Returns desk',
        createdAt: '2026-10-22T09:00:00.000Z',
        taskCount: 180,
      },
    ],
  });
  await installExperimentsFake(launched.app, await recordedComparisonReport(), {
    mentor: 'Qwen3 235B on vLLM',
    student: 'Qwen3 32B',
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

test('lists every connection on Models with how it stands and the roles it can fill', async () => {
  await goTo(page, '/models');
  await page.getByRole('tab', { name: 'Connections' }).click();
  const table = page.getByRole('table', { name: 'Connections' });
  const row = (name: string) => table.getByRole('row', { name: new RegExp(name) });

  // Hosted keys first, then the endpoints added by address, then the runtimes on this computer.
  await expect(table.getByRole('row')).toHaveCount(2 + 6);
  await expect(row('Anthropic')).toContainText('Key saved');
  await expect(row('gpu-node-7:8000')).toContainText(VLLM);
  await expect(row('Ollama')).toContainText('Running · 1 model');
  await expect(row('LM Studio')).toContainText('Not found');

  // Any of them can teach; a cluster serves the copy it practices on; agents run only here.
  const yes = (name: string) => row(name).getByLabel('Yes');
  await expect(yes('Anthropic')).toHaveCount(1);
  await expect(yes('OpenRouter')).toHaveCount(2);
  await expect(yes('dgx-02.lab:30000')).toHaveCount(2);
  await expect(yes('Ollama')).toHaveCount(3);
  await capture('models-connections-dark.png');

  // Read only: adding one is in Settings.
  await page.getByRole('button', { name: 'Add provider or endpoint' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('button', { name: 'Add provider or endpoint' })).toBeVisible();
  await settings.getByRole('button', { name: 'Add provider or endpoint' }).click();
  const adding = page.getByRole('dialog', { name: 'Add a provider or endpoint' });
  await adding.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: /vLLM, SGLang, TGI/ }).click();
  await expect(adding.getByRole('textbox', { name: 'Address' })).toBeVisible();
  await capture('settings-add-endpoint-dark.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

test("names the field's own models on every line of an experiment's design", async () => {
  await goTo(page, '/experiments/new/returns-desk');
  await page
    .getByRole('region', { name: 'Field' })
    .getByRole('button', { name: 'Use field' })
    .click();
  await expect(page).toHaveURL(/#\/experiments\/cmp_1$/);

  const arms = page.getByRole('toolbar', { name: 'Arms' });
  await expect(arms.getByRole('button', { name: /Qwen3 32B alone/ })).toBeVisible();
  await expect(arms.getByRole('button', { name: /Qwen3 235B reference/ })).toBeVisible();
  const estimate = page.getByRole('region', { name: 'Estimate' });
  await expect(estimate.getByRole('meter', { name: 'Qwen3 235B' })).toBeVisible();
  await expect(estimate.getByRole('meter', { name: 'Qwen3 32B' })).toBeVisible();

  const settings = page.getByRole('complementary', { name: 'Experiment settings' });
  // The names are too long to sit beside the other tabs uncut, so those two show their icons.
  await settings.getByRole('tab', { name: 'Qwen3 235B' }).click();
  await expect(settings.getByText("Qwen3 235B's cap for each arm")).toBeVisible();
  await expect(page.getByText(/Spark|Glimmer/)).toHaveCount(0);
  await capture('experiment-design-any-model-dark.png');
  await settings.getByRole('tab', { name: 'Budget' }).click();
  await expect(settings.getByRole('textbox', { name: 'Qwen3 32B' })).toBeVisible();
});
