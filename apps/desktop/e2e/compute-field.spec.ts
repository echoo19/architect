import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FAKE_HUB_TOKEN, startFakeHub, type FakeHub } from '@architect/engine/testing';
import {
  FIELD_EXPORT_FORMAT,
  GLIMMER_TRAINING_BASE,
  TrainBundleSchema,
  type FieldExportManifest,
} from '@architect/shared';
import { goTo, launchApp, settle, type LaunchedApp } from './app';
import { GPU_12GB, LLAMA_SERVER_READY, OLLAMA_READY, stubEngine } from './fixtures';
import { FIELD_JOB } from './fixtures-field';
import { FLOW, FLOW_ENGINE } from './fixtures-flow';

/*
 * Compute opened from a field, on the real engine with a fake Hub (never the real one): the plan
 * starts from the field's student, Glimmer, whose repository the fake Hub serves with a stand-in
 * config.json shaped like a 30B mixture of experts; the field's export recorded before a restart
 * is offered and chosen again before it is read; a SkyPilot bundle is written with the command
 * that launches it. A model Architect can't place leaves the model empty with the field named.
 * The Student tab leads here. Nothing is submitted or launched and no GPU is used.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const REPO = GLIMMER_TRAINING_BASE.repo;
/** A stand-in, not Glimmer's real config.json, which no test reads. */
const STAND_IN = {
  model_type: 'muse_glimmer',
  hidden_size: 2048,
  intermediate_size: 6144,
  moe_intermediate_size: 768,
  num_hidden_layers: 48,
  num_attention_heads: 32,
  num_key_value_heads: 4,
  head_dim: 128,
  num_experts: 128,
  num_experts_per_tok: 8,
  vocab_size: 151936,
  tie_word_embeddings: false,
  torch_dtype: 'bfloat16',
};
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test.describe.configure({ mode: 'serial' });

let hub: FakeHub;
let commit: string;
let launched: LaunchedApp;
let page: Page;
let folders: string;
let exported: string;

/** A field export as `architect field export` writes it, with only verified demonstrations. */
async function writeExport(dir: string): Promise<void> {
  await mkdir(join(dir, 'sft'), { recursive: true });
  const demonstrations = `${JSON.stringify({ messages: [{ role: 'assistant', content: 'ANSWER: 12' }] })}\n`;
  await writeFile(join(dir, 'sft', 'demonstrations.jsonl'), demonstrations);
  const manifest: FieldExportManifest = {
    format: FIELD_EXPORT_FORMAT,
    created_at: '2026-10-31T18:00:00.000Z',
    job: {
      id: FIELD_JOB.id,
      name: FIELD_JOB.name,
      format: 1,
      created_at: '2026-10-30T00:00:00.000Z',
      sha256: sha256('job'),
    },
    counts: {
      demonstrations: 1,
      trained_turns: 1,
      train_tasks: 1,
      train_organizations: 1,
      sealed_organizations: 1,
      locked_test_tasks: 1,
    },
    files: { 'sft/demonstrations.jsonl': sha256(demonstrations) },
    permitted_uses: { sft: [], env: [], eval: [] },
    left_out: [],
  };
  await writeFile(join(dir, 'MANIFEST.json'), JSON.stringify(manifest));
}

test.beforeAll(async () => {
  hub = await startFakeHub();
  hub.repos.set(REPO, { private: false, commits: [] });
  commit = hub.commit(REPO, { 'config.json': Buffer.from(JSON.stringify(STAND_IN)) });
  folders = await mkdtemp(join(tmpdir(), 'architect-e2e-compute-field-'));
  // Folders named as a person's would be, so the screen reads as it would for them.
  exported = join(folders, 'Architect', 'exports', 'academy-desk');
  await writeExport(exported);
  // Exported before this start: recorded in settings, its folder not chosen since.
  launched = await launchApp({
    env: { HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN },
    settings: {
      onboarded: true,
      edition: 'lab',
      fieldExports: [
        {
          jobId: FIELD_JOB.id,
          name: FIELD_JOB.name,
          dir: exported,
          at: '2026-10-31T18:00:00.000Z',
        },
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
    'connections:detectLocal': { ...OLLAMA_READY, gpu: GPU_12GB },
    'connections:llamaServer': LLAMA_SERVER_READY,
    'jobs:get': FIELD_JOB,
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await launched?.close();
  await hub?.close();
  await rm(folders, { recursive: true, force: true });
});

/** The next file dialog chooses this path, and remembers where it was asked to open. */
function picks(path: string): Promise<void> {
  return launched.app.evaluate(({ dialog }, chosen) => {
    const opened = globalThis as { openedAt?: string | undefined };
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as { defaultPath?: string };
      opened.openedAt = options.defaultPath;
      return { canceled: false, filePaths: [chosen] };
    };
  }, path);
}

const openedAt = () =>
  launched.app.evaluate(() => (globalThis as { openedAt?: string | undefined }).openedAt);

async function capture(file: string, top?: Locator): Promise<void> {
  await page.mouse.move(0, 0);
  if (top) await top.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

const region = (name: string) => page.getByRole('region', { name, exact: true });
const computeFor = (model?: string) =>
  `/compute/fields/${encodeURIComponent(FIELD_JOB.id)}${model === undefined ? '' : `/${encodeURIComponent(model)}`}`;

test("opened from a field, plans its student's model at once and offers its earlier export", async () => {
  await goTo(page, computeFor());
  const card = region('Training plan');
  await expect(card.getByLabel('Model')).toHaveValue(REPO);
  await expect(card).toContainText(`For ${FIELD_JOB.name}, from its student muse-glimmer:30b`);
  await expect(region('Memory on each GPU').getByText('Estimate')).toBeVisible();
  await expect(card).toContainText(`${REPO} @ ${commit.slice(0, 12)}`);
  // Only config.json was read, at the commit main resolved to.
  const files = hub.requests.filter((request) => request.path.includes('/resolve/'));
  expect(files.map((request) => request.path)).toEqual([`/${REPO}/resolve/${commit}/config.json`]);

  const clusters = region('Clusters');
  await expect(clusters.getByText('Bundle only')).toBeVisible();
  for (const command of [
    'sbatch submit.sbatch',
    'kubectl apply -f pytorchjob.yaml',
    'sky launch -c architect-train sky.yaml',
  ]) {
    await expect(clusters).toContainText(command);
  }
  await capture('compute-field-dark.png', card);

  // The export from before the restart is offered, and waits to be chosen again.
  const bundle = region('Bundle');
  await expect(bundle).toContainText(`Field export of ${FIELD_JOB.name}`);
  await expect(bundle).toContainText(/…[\\/]exports[\\/]academy-desk/);
  await expect(bundle).toContainText('Choose the field export again.');
  await expect(bundle.getByRole('button', { name: 'Write bundle' })).toBeDisabled();
  await capture('compute-field-export-dark.png', bundle);
});

test('writes a SkyPilot bundle from the export once it is chosen again, and shows the command', async () => {
  const bundle = region('Bundle');
  await picks(exported);
  await bundle.getByRole('button', { name: 'Choose again' }).click();
  // The dialog opened at the folder recorded before the restart.
  expect(await openedAt()).toBe(exported);
  await expect(bundle).not.toContainText('Choose the field export again.');
  const out = join(folders, 'Architect', 'bundles');
  await mkdir(out, { recursive: true });
  await picks(out);
  await bundle.getByRole('button', { name: 'Choose', exact: true }).nth(1).click();
  await bundle.getByRole('radio', { name: 'SkyPilot' }).click();
  await bundle.getByRole('button', { name: 'Write bundle' }).click();

  const submit = bundle.getByRole('region', { name: 'Submit command' });
  await expect(submit).toContainText('sky launch -c architect-train sky.yaml');
  await expect(bundle).toContainText('Architect writes this bundle and never submits it.');
  const [written] = await readdir(out);
  if (written === undefined) throw new Error('No bundle was written.');
  expect(written).toMatch(/skypilot$/);
  const dir = join(out, written);
  const record = TrainBundleSchema.parse(
    JSON.parse(await readFile(join(dir, 'bundle.json'), 'utf8')),
  );
  expect(record.target).toBe('skypilot');
  expect(record.base_model).toEqual({ repo: REPO, revision: commit });
  expect(record.field_export?.data.map((file) => file.name)).toEqual(['demonstrations.jsonl']);
  // The task's structure is checked against a stand-in SkyPilot in the engine's tests.
  const task = await readFile(join(dir, 'sky.yaml'), 'utf8');
  expect(task).toMatch(new RegExp(`^num_nodes: ${record.nodes}$`, 'm'));
  expect(task).toMatch(new RegExp(`^  accelerators: H100:${record.gpus_per_node}$`, 'm'));
  expect(existsSync(join(dir, 'data', 'demonstrations.jsonl'))).toBe(true);
  // The Hub heard of config.json and nothing else: no job, no upload.
  expect(hub.jobs.size).toBe(0);
  expect(hub.uploads).toEqual([]);
  await capture('compute-skypilot-dark.png', bundle);
});

test("names the field and leaves the model empty when it can't place the student", async () => {
  await goTo(page, computeFor('acme-tutor:7b'));
  const card = region('Training plan');
  await expect(card.getByLabel('Model')).toHaveValue('');
  await expect(card).toContainText(
    `For ${FIELD_JOB.name}. Its student, acme-tutor:7b, has no Hugging Face repository Architect knows`,
  );
  await expect(region('Memory on each GPU')).toHaveCount(0);
  await capture('compute-field-unknown-dark.png', region('Clusters'));
});

test("the Student tab plans the field's cluster training in one step", async () => {
  // The flow's stand-ins answer the job, its tasks and the runtimes; file picks are theirs now.
  await stubEngine(launched.app, FLOW_ENGINE);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Advanced settings' });
  await inspector.getByRole('tab', { name: 'Glimmer' }).click();
  await inspector.getByRole('button', { name: 'Plan cluster training' }).click();
  await expect(page).toHaveURL(new RegExp(`#/compute/fields/${FLOW.jobId}$`));
  await expect(region('Training plan').getByLabel('Model')).toHaveValue(REPO);
});
