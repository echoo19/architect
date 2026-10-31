import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Job, RecordingQuote, TaskPlan, Transcript } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { FLOW_ENGINE, taskPlan } from './fixtures-flow';
import { job } from './story';

/*
 * A field job's recordings on Define, on a stand-in engine (decision 087): "Add recordings" for a
 * taught academy, the cost and where the recordings go before anything is sent, the job's setting
 * that lets them go, and the transcripts listed with what each cost.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SCRATCH = process.env['ARCHITECT_SHOTS_DIR'];
const WIDTH = 1440;
const HEIGHT = 1100;

const desk: Job = {
  ...job,
  id: 'academy-desk',
  name: 'Academy desk',
  summary: 'Answers families from the academy’s own files.',
  taskTypes: [
    { id: 'diagnose', label: 'Diagnose' },
    { id: 'assign', label: 'Assign practice' },
  ],
  organizations: [
    { id: 'northside', name: 'Northside Prep', synthetic: true, role: 'train' },
    { id: 'lakeview', name: 'Lakeview Tutors', synthetic: true, role: 'train' },
  ],
};

const PICKED = [
  'C:\\Recordings\\Front desk call.wav',
  'C:\\Recordings\\Staff meeting, October.wav',
];

const quote: RecordingQuote = {
  org: 'northside',
  files: [
    { path: PICKED[0] ?? '', name: 'Front desk call.wav', seconds: 252, usd: 0.0126, done: false },
    {
      path: PICKED[1] ?? '',
      name: 'Staff meeting, October.wav',
      seconds: 1_388,
      usd: 0.0694,
      done: false,
    },
  ],
  seconds: 1_640,
  usd: 0.082,
  capUsd: 1,
};

function transcript(source: string, file: string, seconds: number, org = 'northside'): Transcript {
  return {
    org,
    source,
    sourceSha256: 'a'.repeat(64),
    file,
    seconds,
    usd: (seconds * 0.18) / 3600,
    model: 'muse-voice-transcribe-1.0',
    createdAt: '2026-10-30T15:00:00.000Z',
  };
}

const before: TaskPlan = {
  ...taskPlan,
  study: { state: 'unstudied', token: '' },
  recordings: { allowed: false, capUsd: 1, transcripts: [] },
};
const allowed: TaskPlan = {
  ...before,
  recordings: { allowed: true, capUsd: 1, transcripts: [] },
};
const after: TaskPlan = {
  ...before,
  recordings: {
    allowed: true,
    capUsd: 1,
    transcripts: [
      transcript('Lesson walkthrough.wav', 'lesson-walkthrough.transcript.txt', 611, 'lakeview'),
      transcript('Front desk call.wav', 'front-desk-call.transcript.txt', 252),
      transcript('Staff meeting, October.wav', 'staff-meeting-october.transcript.txt', 1_388),
    ],
  },
};

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
  await mkdir(OUT_DIR, { recursive: true });
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width: WIDTH, height: HEIGHT },
  );
  await launched.page.waitForFunction((h) => window.innerHeight === h, HEIGHT);
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(page: Page, dir: string, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(dir, `${name}.png`), animations: 'disabled' });
}

test('adds a taught academy’s recordings, with the cost and consent before anything is sent', async () => {
  const { app, page } = launched;
  await stubEngine(app, {
    ...FLOW_ENGINE,
    'jobs:get': desk,
    'jobs:save': desk,
    'jobs:taskPlan': before,
    'files:pick': PICKED,
    'jobs:quoteRecordings': quote,
    'jobs:shareRecordings': allowed,
    'jobs:transcribe': after,
  });
  await updateSettings(page, { onboarded: true, comparisonMode: false });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/jobs/${desk.id}/define`);

  const section = page.getByRole('region', { name: 'Recordings' });
  await expect(section).toBeVisible();
  await section.getByRole('button', { name: 'Add recordings' }).click();
  await page.getByRole('menuitem', { name: 'Northside Prep' }).click();

  const dialog = page.getByRole('dialog', { name: 'Transcribe 2 recordings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Front desk call.wav')).toBeVisible();
  await expect(dialog.getByText('4:12 · $0.01')).toBeVisible();
  await expect(dialog.getByText(/sent to Meta to be transcribed by Muse Voice/)).toBeVisible();
  await expect(dialog.getByText(/\$0\.08 of Meta credit/)).toBeVisible();
  const send = dialog.getByRole('button', { name: 'Send and transcribe' });
  // Nothing goes until the job's setting lets recordings go to Meta.
  await expect(send).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /send recordings to Meta/ }).click();
  await expect(send).toBeEnabled();
  if (SCRATCH !== undefined) await capture(page, SCRATCH, 'study-recordings-dialog');
  await send.click();
  await expect(dialog).toBeHidden();

  const listed = section.getByRole('list', { name: 'Transcripts' });
  await expect(listed.getByRole('listitem')).toHaveCount(3);
  await expect(listed.getByText('Staff meeting, October.wav')).toBeVisible();
  await expect(listed.getByText('23:08 · $0.07')).toBeVisible();
  await capture(page, OUT_DIR, 'study-recordings-dark');
});
