import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FAKE_HUB_TOKEN, startFakeHub, type FakeHub } from '@architect/engine/testing';
import { planTraining } from '@architect/engine/training-plan';
import {
  FIELD_EXPORT_FORMAT,
  TrainBundleSchema,
  type FieldExportManifest,
  type ModelConfig,
  type TrainMethod,
} from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { GPU_12GB, LLAMA_SERVER_READY, OLLAMA_READY, stubEngine } from './fixtures';

/*
 * The Compute place on the real engine: its targets, a training plan sized from a stand-in
 * config.json served by the fake Hub (never the real one), a config it refuses, and Slurm and
 * Kubernetes bundles written into folders the dialog hands it. Nothing is submitted, no model is
 * loaded and no GPU is used; this computer's runtimes are stand-ins.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const CONFIGS = fileURLToPath(
  new URL('../../../packages/engine/test/fixtures/model-configs/', import.meta.url),
);
const SIZE = { width: 1440, height: 900 };
const REPO = 'lab/moe-235b';
const MOE = JSON.parse(readFileSync(join(CONFIGS, 'moe-235b.json'), 'utf8')) as ModelConfig;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

test.describe.configure({ mode: 'serial' });

let hub: FakeHub;
let commit: string;
let launched: LaunchedApp;
let page: Page;
let folders: string;

test.beforeAll(async () => {
  hub = await startFakeHub();
  hub.repos.set(REPO, { private: false, commits: [] });
  commit = hub.commit(REPO, { 'config.json': Buffer.from(JSON.stringify(MOE)) });
  folders = await mkdtemp(join(tmpdir(), 'architect-e2e-compute-'));
  launched = await launchApp({ env: { HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN } });
  page = launched.page;
  const visible = await launched.app.evaluate(({ BrowserWindow }, size) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(size.width, size.height);
    return main.isVisible();
  }, SIZE);
  expect(visible).toBe(false);
  await mkdir(OUT_DIR, { recursive: true });
  await updateSettings(page, { onboarded: true, edition: 'lab' });
  // This computer's GPU and runtimes as stand-ins: no nvidia-smi, no Ollama of the developer's.
  await stubEngine(launched.app, {
    'connections:detectLocal': { ...OLLAMA_READY, gpu: GPU_12GB },
    'connections:llamaServer': LLAMA_SERVER_READY,
  });
  // What the first screen read before the stand-ins went in is forgotten.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await launched?.close();
  await hub?.close();
  await rm(folders, { recursive: true, force: true });
});

/** The next file dialog chooses this path. */
function picks(path: string): Promise<void> {
  return launched.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, path);
}

async function capture(file: string, top?: Locator): Promise<void> {
  await page.mouse.move(0, 0);
  if (top) await top.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

const region = (name: string) => page.getByRole('region', { name, exact: true });
const settings = () => page.getByRole('complementary', { name: 'Plan settings' });

/** The fewest GPUs the engine sizes for the stand-in, with the screen's default settings. */
function gpusFor(method: TrainMethod, seqLen = 4096): number {
  const plan = planTraining(MOE, {
    model: { repo: REPO, revision: commit },
    method,
    precision: 'bf16',
    gpu: { name: 'H100 80GB', memoryGb: 80 },
    seqLen,
    microBatch: 1,
    gpusPerNode: 8,
    loraRank: 16,
  });
  if (!plan.fit) throw new Error('The stand-in should fit.');
  return plan.fit.gpus;
}

test('shows each target with what it can do, the clusters as bundles only', async () => {
  await goTo(page, '/compute');
  const computer = region('This computer');
  await expect(computer).toContainText('NVIDIA GeForce RTX 4070 · 12 GB');
  await expect(computer).toContainText('Running · 0.12.6');
  await expect(computer).toContainText('Ready · build 10472');
  await expect(region('Hugging Face Jobs')).toContainText('Ready');
  await expect(region('Hugging Face Jobs')).toContainText('HF_TOKEN');
  const clusters = region('Clusters');
  await expect(clusters.getByText('Bundle only')).toBeVisible();
  for (const command of [
    'sbatch submit.sbatch',
    'kubectl apply -f pytorchjob.yaml',
    'sky launch -c architect-train sky.yaml',
  ]) {
    await expect(clusters).toContainText(command);
  }
  // No model is planned until the person enters one.
  await expect(region('Training plan').getByLabel('Model')).toHaveValue('');
  await expect(region('Memory on each GPU')).toHaveCount(0);
  await capture('compute-dark.png');
});

test('plans a mixture of experts from its config.json on the Hub, every term with its arithmetic', async () => {
  const card = region('Training plan');
  await card.getByLabel('Model').fill(REPO);
  await card.getByRole('button', { name: 'Read config' }).click();

  const breakdown = region('Memory on each GPU');
  await expect(breakdown.getByText('Estimate')).toBeVisible();
  await expect(card).toContainText(`${REPO} @ ${commit.slice(0, 12)}`);
  await expect(card).toContainText('128');
  const lora = gpusFor('lora');
  // The answer leads; the arithmetic is a click away.
  await expect(breakdown).toContainText(`Fits on ${lora} GPUs in`);
  await expect(breakdown.getByText(String(lora), { exact: true }).first()).toBeVisible();
  await expect(breakdown).toContainText('Sized for H100 80GB, 8 per node, bf16');
  const terms = breakdown.getByRole('table', { name: 'Memory terms' });
  await expect(terms).toBeHidden();
  await breakdown.getByRole('button', { name: 'How this is worked out' }).click();
  for (const label of [
    'Resident weights, all 128 experts in every expert layer, frozen',
    'LoRA adapter on attention and every MLP or expert projection, in fp32',
    "The adapter's gradients, in fp32",
    "Adam's two fp32 moments for the adapter",
    'Activations for one micro-batch (approximate)',
    'CUDA context, cuBLAS workspace and NCCL buffers',
    'Usable per GPU',
  ]) {
    await expect(terms.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(terms).toContainText("FSDP's peak");
  await expect(terms).toContainText('80 GB × (1 − 0.1) = 72.0 GB usable on each H100 80GB');

  // Only config.json was read, at the commit its revision resolved to.
  const files = hub.requests.filter((request) => request.path.includes('/resolve/'));
  expect(files.map((request) => request.path)).toEqual([`/${REPO}/resolve/${commit}/config.json`]);

  // QLoRA, and a longer sequence in the inspector, are sized again at once.
  await card.getByRole('radio', { name: 'QLoRA' }).click();
  await expect(terms).toContainText('NF4 with double quantization');
  await settings().getByRole('tab', { name: 'Training' }).click();
  await settings().getByLabel('Tokens per sequence').fill('8192');
  await expect(terms).toContainText('b·s·h·2·L = 1·8192·4096·2·94');
  await expect(
    breakdown.getByText(String(gpusFor('qlora', 8192)), { exact: true }).first(),
  ).toBeVisible();
  await settings().getByLabel('Tokens per sequence').fill('4096');
  await card.getByRole('radio', { name: 'LoRA', exact: true }).click();
  await expect(terms).not.toContainText('NF4 with double quantization');
  // The hardware the plan was sized for opens beside it.
  await breakdown.getByRole('button', { name: 'Change hardware' }).click();
  await expect(settings().getByRole('tab', { name: 'Hardware' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await capture('compute-plan-terms-dark.png', breakdown);
  await breakdown.getByRole('button', { name: 'How this is worked out' }).click();
  await expect(terms).toBeHidden();
  await capture('compute-plan-dark.png', card);
});

test("says plainly why a config can't be sized", async () => {
  const mamba = join(folders, 'mamba-config.json');
  await writeFile(mamba, JSON.stringify({ ...MOE, model_type: 'mamba' }));
  const card = region('Training plan');
  await card.getByRole('radio', { name: 'config.json' }).click();
  await picks(mamba);
  await card.getByRole('button', { name: 'Choose config.json' }).click();
  const refusal = region('Memory on each GPU');
  await expect(refusal.getByText("Can't size this model")).toBeVisible();
  await expect(refusal).toContainText("A mamba model isn't a decoder made of attention");
  await expect(region('Bundle').getByRole('button', { name: 'Write bundle' })).toBeDisabled();

  await card.getByRole('radio', { name: 'Hugging Face' }).click();
  await card.getByRole('button', { name: 'Read config' }).click();
  await expect(region('Memory on each GPU').getByText('Estimate')).toBeVisible();
});

test('writes Slurm and Kubernetes bundles from a field export and shows the commands', async () => {
  // Folders named as a person's would be, so the screen reads as it would for them.
  const exported = join(folders, 'Architect', 'exports', 'academy-desk');
  await mkdir(join(exported, 'sft'), { recursive: true });
  // A bundle takes only a verified export: every sft file listed in the manifest with its hash.
  const demonstrations = `${JSON.stringify({ messages: [{ role: 'assistant', content: 'ANSWER: 12' }] })}\n`;
  await writeFile(join(exported, 'sft', 'demonstrations.jsonl'), demonstrations);
  const manifest: FieldExportManifest = {
    format: FIELD_EXPORT_FORMAT,
    created_at: '2026-10-30T00:00:00.000Z',
    job: {
      id: 'academy-desk',
      name: 'Academy desk',
      format: 1,
      created_at: '2026-10-30T00:00:00.000Z',
      sha256: sha256('job'),
    },
    counts: {
      demonstrations: 1,
      trained_turns: 1,
      train_tasks: 1,
      train_organizations: 1,
      sealed_organizations: 0,
      locked_test_tasks: 0,
    },
    files: { 'sft/demonstrations.jsonl': sha256(demonstrations) },
    permitted_uses: { sft: [], env: [], eval: [] },
    left_out: [],
  };
  await writeFile(join(exported, 'MANIFEST.json'), JSON.stringify(manifest));
  const out = join(folders, 'Architect', 'bundles');
  await mkdir(out, { recursive: true });

  const bundle = region('Bundle');
  const write = bundle.getByRole('button', { name: 'Write bundle' });
  await expect(write).toBeDisabled();
  await expect(bundle).toContainText('Choose a field export.');
  await picks(exported);
  await bundle.getByRole('button', { name: 'Choose' }).first().click();
  await picks(out);
  await bundle.getByRole('button', { name: 'Choose' }).nth(1).click();
  await write.click();

  const submit = bundle.getByRole('region', { name: 'Submit command' });
  await expect(submit).toContainText('sbatch submit.sbatch');
  await expect(bundle).toContainText('Architect writes this bundle and never submits it.');
  await expect(bundle).toContainText(/…[\\/]exports[\\/]academy-desk/);
  await expect(bundle).not.toContainText(folders);
  const slurm = join(out, 'moe-235b-slurm');
  const written = TrainBundleSchema.parse(
    JSON.parse(await readFile(join(slurm, 'bundle.json'), 'utf8')),
  );
  expect(written.base_model).toEqual({ repo: REPO, revision: commit });
  expect(written.target).toBe('slurm');
  expect(written.nodes * written.gpus_per_node).toBe(gpusFor('lora'));
  expect(existsSync(join(slurm, 'data', 'demonstrations.jsonl'))).toBe(true);
  await capture('compute-bundle-dark.png', bundle);

  await bundle.getByRole('radio', { name: 'Kubernetes' }).click();
  await expect(submit).toBeHidden();
  await write.click();
  await expect(bundle.getByRole('region', { name: 'Submit command' })).toContainText(
    'kubectl apply -f pytorchjob.yaml',
  );
  expect(existsSync(join(out, 'moe-235b-kubernetes', 'pytorchjob.yaml'))).toBe(true);
  // The Hub heard of config.json and nothing else: no job, no upload.
  expect(hub.jobs.size).toBe(0);
  expect(hub.uploads).toEqual([]);
});
