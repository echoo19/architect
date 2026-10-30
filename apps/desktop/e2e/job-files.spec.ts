import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { glimmerBuild, OLLAMA_BASE_URL, type Job } from '@architect/shared';
import { goTo, launchApp, type LaunchedApp } from './app';

/*
 * Job files on the real engine: a job folder imported from a file dialog, a file that isn't one, a
 * job exported and imported again, and a checker file chosen in Define. The system dialogs are
 * answered in the main process, so nothing appears on screen.
 */

const SAMPLE_JOB = fileURLToPath(new URL('../../../examples/home-services/job', import.meta.url));
const GPU_BUILD = glimmerBuild('glimmer-gpu').model;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;
let work: string;
/** A job folder as someone would hand it over: job.json, tasks.jsonl, data/ and checker.js. */
let jobFolder: string;

test.beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'architect-e2e-jobfiles-'));
  jobFolder = join(work, 'downloaded-job');
  await cp(SAMPLE_JOB, jobFolder, { recursive: true });
  // The person set up the 2-bit build in setup; nothing is connected beyond the default teacher.
  launched = await launchApp({
    settings: {
      onboarded: true,
      defaultStudent: {
        runtime: 'ollama',
        baseUrl: OLLAMA_BASE_URL,
        model: GPU_BUILD,
        contextLength: 16_384,
      },
    },
  });
  page = launched.page;
});

test.afterAll(async () => {
  await launched?.close();
  await rm(work, { recursive: true, force: true });
});

/** The next open dialog chooses `file`. */
function choose(file: string): Promise<void> {
  return launched.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, file);
}

/** The next save dialog chooses `file`. */
function saveTo(file: string): Promise<void> {
  return launched.app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: chosen });
  }, file);
}

const jobs = () => page.evaluate(() => window.architect.jobs.list());

test('says plainly that a file is not a job file, and imports nothing', async () => {
  const notes = join(work, 'notes.json');
  await writeFile(notes, 'Remember the milk.');
  await choose(notes);
  await goTo(page, '/new');
  await page.getByRole('button', { name: 'Import a job file' }).click();

  await expect(page.getByText("Couldn't import the job file")).toBeVisible();
  await expect(
    page.getByText(
      "That isn't a job file. A job folder holds job.json, tasks.jsonl and the files the job works on, in a data folder or in each organization's orgs/<id>/data folder. Choose its job.json.",
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Job folder format' })).toBeVisible();
  await expect(page).toHaveURL(/#\/new$/);
  expect(await jobs()).toEqual([]);
});

test('imports a job file as a new job that starts from the model the person chose', async () => {
  await choose(join(jobFolder, 'job.json'));
  await goTo(page, '/new');
  await page.getByRole('button', { name: 'Import a job file' }).click();

  await expect(page).toHaveURL(/#\/jobs\/[^/]+\/define$/);
  await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  const [listed, ...others] = await jobs();
  expect(others).toEqual([]);
  expect(listed).toMatchObject({ name: 'Service desk', taskCount: 180 });

  // The file says Glimmer's 4-bit build; the person set up the 2-bit one, and the job has that.
  const job: Job = await page.evaluate((id) => window.architect.jobs.get(id), listed?.id ?? '');
  expect(job.student.local.model).toBe(GPU_BUILD);
  expect(job.student.trainOn).toBe('local');
  expect(job.student.hosted).toBeUndefined();
  expect(job.mentor).toMatchObject({ provider: 'meta', model: 'muse-spark-1.3' });

  // Nothing is saved yet to teach with, and the screen says so before it starts anything.
  await expect(page.getByRole('region', { name: 'Before it can start' })).toContainText(
    'Spark needs a Meta key',
  );
  await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();

  // Its tasks were split when they were imported, so the sets are shown and say so.
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  const advanced = page.getByRole('complementary', { name: 'Advanced settings' });
  await advanced.getByRole('tab', { name: 'Evaluation' }).click();
  await expect(advanced).toContainText("the sets can't change now");
  const sets = advanced.getByRole('region', { name: 'Task sets' });
  await expect(sets.getByRole('textbox')).toHaveCount(0);
  await expect(sets).toContainText(/Practice\s*60 tasks/);
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  await expect(advanced).toBeHidden();
});

test('exports the job file, and imports it again beside its tasks and data as another job', async () => {
  const [original] = await jobs();
  expect(original).toBeDefined();
  const id = original?.id ?? '';
  await goTo(page, `/jobs/${id}/define`);

  const exported = join(work, 'exported', 'service-desk.job.json');
  await cp(jobFolder, join(work, 'exported'), { recursive: true });
  await rm(join(work, 'exported', 'job.json'));
  await saveTo(exported);
  await page.getByRole('button', { name: 'Export the job file' }).click();
  await expect(
    page.getByText('service-desk.job.json. Its tasks and data files stay on this computer.'),
  ).toBeVisible();

  // The file is the job as saved, and holds no task: the test split never leaves the vault.
  const written = JSON.parse(await readFile(exported, 'utf8')) as Job;
  expect(written).toEqual(await page.evaluate((jobId) => window.architect.jobs.get(jobId), id));
  expect(written).not.toHaveProperty('tasks');

  // Beside its tasks and data, it imports as a job of its own.
  await choose(exported);
  await goTo(page, '/new');
  await page.getByRole('button', { name: 'Import a job file' }).click();
  await expect(page).toHaveURL(/#\/jobs\/[^/]+\/define$/);
  const after = await jobs();
  expect(after).toHaveLength(2);
  expect(after.map((job) => job.name)).toEqual(['Service desk', 'Service desk']);
  expect(new Set(after.map((job) => job.id)).size).toBe(2);
  expect(after.map((job) => job.taskCount)).toEqual([180, 180]);
});

test('says a file with no data beside it is missing its data', async () => {
  const lonely = join(work, 'lonely', 'job.json');
  await cp(join(jobFolder, 'job.json'), lonely);
  await choose(lonely);
  await goTo(page, '/new');
  await page.getByRole('button', { name: 'Import a job file' }).click();
  await expect(
    page.getByText(
      /The data file "[^"]+" is missing; it belongs in a data folder next to the job file\./,
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/new$/);
  expect(await jobs()).toHaveLength(2);
});

test('copies a checker file chosen in Define into the job, and only one that was chosen', async () => {
  const [first] = await jobs();
  const id = first?.id ?? '';
  const checks = join(work, 'my-checks.js');
  await writeFile(checks, 'exports.checks = { total: () => ({ pass: true, reason: "Fine." }) };\n');
  await goTo(page, `/jobs/${id}/define`);
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  const advanced = page.getByRole('complementary', { name: 'Advanced settings' });
  await advanced.getByRole('tab', { name: 'Evaluation' }).click();
  await expect(advanced.getByText('checker.js', { exact: true }).first()).toBeVisible();

  await choose(checks);
  await advanced.getByRole('button', { name: 'Change' }).click();
  const checkerOf = () =>
    page.evaluate(async (jobId) => {
      const { checker } = await window.architect.jobs.get(jobId);
      return checker.kind === 'module' ? checker.path : '';
    }, id);
  await expect.poll(checkerOf).toMatch(/^my-checks-[0-9a-f]{12}\.js$/);
  await expect(page.getByText('Checker file saved', { exact: true })).toBeVisible();
  const kept = await checkerOf();
  await expect(advanced.getByText(kept).first()).toBeVisible();
  const { dataPath } = await page.evaluate(() => window.architect.app.info());
  expect(existsSync(join(dataPath, 'jobs', id, kept))).toBe(true);

  // A file nobody chose in a dialog can't be named: it would be read from anywhere on this computer.
  const message = await page.evaluate(
    ([jobId, path]) =>
      window.architect.jobs
        .get(jobId as string)
        .then((current) =>
          window.architect.jobs.save({
            ...current,
            checker: { kind: 'module', path: path as string },
          }),
        )
        .then(
          () => 'saved',
          (error: Error) => error.message,
        ),
    [id, join(work, 'never-chosen.js')],
  );
  expect(message).toContain('Architect only opens files and folders you choose');
});
