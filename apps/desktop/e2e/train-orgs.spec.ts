import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Experiment, Job, Measurement, Organization, RunDetail } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { SAMPLE_ENGINE, stubEngine } from './fixtures';
import { at, detail, makeRun, roundDiff, STORY, trace, trainedJob } from './story';

/*
 * The check score at each organization while a field trains (decision 085), against the stand-in
 * engine: a row per organization under the Train screen's score, and in the round drawer's check
 * tasks; nothing of it for a job of one organization.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
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
});

test.afterAll(async () => {
  await launched?.close();
});

async function openAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

const ORGS: Organization[] = [
  { id: 'northside', name: 'Northside Prep', synthetic: true, role: 'train' },
  { id: 'lakeview', name: 'Lakeview Academy', synthetic: true, role: 'train' },
];
const FIELD: Job = { ...trainedJob, organizations: ORGS, organizationNoun: 'academy' };

function measured(label: string, version: number, pass: [number, number]): Measurement {
  return {
    label,
    configuration: { harnessVersion: version, actor: 'student', backend: 'ollama', adapter: null },
    seeds: [1, 2],
    score: { pass: pass[0] + pass[1], total: 80 },
    perType: [
      { type: 'invoice', pass: Math.min(28, pass[0] + pass[1] - 22), total: 32 },
      { type: 'overdue', pass: 12, total: 24 },
      { type: 'scheduling', pass: 10, total: 24 },
    ],
    perOrg: [
      { org: 'northside', pass: pass[0], total: 40 },
      { org: 'lakeview', pass: pass[1], total: 40 },
    ],
    latencyMs: { p50: 4_200, p95: 9_800 },
    provenance: 'Measured in this round, and again on new seeds.',
  };
}

const EXPERIMENT: Experiment = {
  id: 'exp_round3field',
  runId: STORY.runId,
  round: 3,
  interventionId: null,
  kind: 'harness',
  title: 'Cents, not dollars',
  inputs: {
    baseVersion: 2,
    candidateVersion: 4,
    incumbentAdapter: null,
    candidateAdapter: null,
    lessonIds: [],
    datasetSha256: null,
    trainingJobId: null,
    trainingBackend: null,
  },
  recipe: null,
  seeds: { dev: [1, 2], train: 3 },
  decoding: null,
  measurements: [measured('incumbent', 2, [27, 25]), measured('candidate', 4, [34, 28])],
  devBefore: { pass: 52, total: 80 },
  devAfter: { pass: 62, total: 80 },
  perType: [],
  regressions: [],
  gates: [],
  budget: {
    mentorUsd: 0.05,
    mentorInputTokens: 20_000,
    mentorOutputTokens: 4_000,
    studentUsd: 0,
    studentInputTokens: 0,
    studentOutputTokens: 0,
    computeUsd: 0,
    computeMinutes: 0,
    examples: 0,
    trainedTokens: 0,
    attempts: 160,
    minutes: 22,
  },
  disposition: 'kept',
  reason: 'Dev 52/80 → 62/80 over 2 runs.',
  startedAt: at(40),
  endedAt: at(62),
};

const FIELD_DETAIL: RunDetail = {
  ...detail,
  job: FIELD,
  run: makeRun({
    devByOrg: [
      { org: 'northside', pass: 34, total: 40 },
      { org: 'lakeview', pass: 28, total: 40 },
    ],
  }),
};

test('shows the check score at each organization under the score and in the round drawer', async () => {
  await stubEngine(launched.app, {
    ...SAMPLE_ENGINE,
    'jobs:get': FIELD,
    'runs:get': FIELD_DETAIL,
    'runs:trace': trace,
    'runs:roundDiff': roundDiff,
    'mentoring:experiments': [EXPERIMENT],
  });
  await openAt(`/runs/${STORY.runId}/train`);

  const byOrg = page.getByRole('list', { name: 'Check tasks by organization' });
  await expect(byOrg.getByRole('listitem')).toHaveText([
    'Northside Prep85% · 17/20',
    'Lakeview Academy70% · 14/20',
  ]);
  await expect(byOrg.getByLabel('Northside Prep: 17 of 20')).toBeVisible();
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, 'train-per-org-dark.png'),
    animations: 'disabled',
    timeout: 15_000,
  });

  const rounds = page.getByRole('region', { name: 'Rounds' });
  await rounds.getByRole('button', { name: /Cents, not dollars/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Round 3: Cents, not dollars' });
  const table = drawer.getByRole('table', { name: 'Check tasks by type' });
  const row = (name: string) =>
    table.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await expect(row('Northside Prep')).toContainText('27 of 40');
  await expect(row('Northside Prep')).toContainText('34 of 40');
  await expect(row('Lakeview Academy')).toContainText('28 of 40');
  await page.keyboard.press('Escape');
});

test('shows no organization rows for a job of one organization', async () => {
  await stubEngine(launched.app, {
    ...SAMPLE_ENGINE,
    'runs:trace': trace,
    'runs:roundDiff': roundDiff,
  });
  await openAt(`/runs/${STORY.runId}/train`);
  await expect(page.getByRole('region', { name: 'Score on the check tasks' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Check tasks by organization' })).toHaveCount(0);
});
