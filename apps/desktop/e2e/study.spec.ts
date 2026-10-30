import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Job, StudyBrief, StudyState, TaskPlan } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { FLOW_ENGINE, taskPlan } from './fixtures-flow';
import { job } from './story';

/*
 * A field job on Define, on a stand-in engine: before anything trains, the page shows what the
 * teacher understood of the academies' material (decision 069), each rule's passages behind a
 * disclosure, and Start training waits until the person confirms it.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const WIDTH = 1440;
const HEIGHT = 1900;

const phil: Job = {
  ...job,
  id: 'phil',
  name: 'Phil',
  summary: 'Helps a student right after a wrong answer.',
  does: [
    "Names the topic and the right choice from the academy's own labels",
    'Gives an approved first hint',
    "Assigns practice the way the academy's policy says",
  ],
  doesNot: ['Gives the answer away', "Uses one academy's rules at another"],
  budget: { ...job.budget, maxWallMinutes: 1_200 },
  taskTypes: [
    { id: 'diagnose', label: 'Diagnose' },
    { id: 'hint', label: 'First hint' },
    { id: 'assign', label: 'Assign practice' },
  ],
  organizations: [
    { id: 'northside', name: 'Northside Prep', synthetic: true, role: 'train' },
    { id: 'lakeview', name: 'Lakeview Tutors', synthetic: true, role: 'train' },
    { id: 'harbor', name: 'Harbor Learning', synthetic: true, role: 'transfer' },
  ],
};

const brief: StudyBrief = {
  organizations: [
    { id: 'northside', name: 'Northside Prep' },
    { id: 'lakeview', name: 'Lakeview Tutors' },
  ],
  skills: [
    {
      taskType: 'diagnose',
      label: 'Diagnose',
      text: 'Name the topic of a missed question, its right choice and the error behind the choice made.',
      needs: ['questions.csv', 'topics.csv'],
      steps: ['Find the question in questions.csv.'],
      quotes: [{ org: 'northside', file: 'topics.csv', passage: 'topic_id,label,rule' }],
      own: false,
    },
    {
      taskType: 'hint',
      label: 'First hint',
      text: "Choose an approved first hint from the academy's catalog for the topic.",
      needs: ['hints.csv'],
      steps: ['Read the hints of the topic in hints.csv.'],
      quotes: [{ org: 'lakeview', file: 'policy.md', passage: 'Never give the answer in a hint.' }],
      own: false,
    },
    {
      taskType: 'assign',
      label: 'Assign practice',
      text: 'Set follow-up questions of the same topic the student has not tried, in the band.',
      needs: ['policy.md', 'questions.csv', 'attempts.csv'],
      steps: ['Read the practice count in policy.md.'],
      quotes: [],
      own: true,
    },
  ],
  connections: [],
  rules: [
    {
      text: 'Practice is of the same topic, not yet attempted, and within the difficulty band.',
      quotes: [
        {
          org: 'northside',
          file: 'policy.md',
          passage:
            'Assign 3 practice questions of the same topic that the student has not attempted.',
        },
        {
          org: 'lakeview',
          file: 'policy.md',
          passage: 'Follow-up practice stays within one difficulty level of the missed question.',
        },
      ],
      own: false,
    },
    {
      text: 'Staff hear about a student who keeps missing one topic.',
      quotes: [
        {
          org: 'lakeview',
          file: 'policy.md',
          passage: 'Write a staff note after 3 wrong answers in a row on one topic.',
        },
      ],
      own: false,
    },
  ],
  differences: [
    {
      text: 'Northside assigns three practice questions after a miss; Lakeview assigns five.',
      quotes: [
        {
          org: 'northside',
          file: 'policy.md',
          passage:
            'Assign 3 practice questions of the same topic that the student has not attempted.',
        },
        { org: 'lakeview', file: 'policy.md', passage: 'Assign 5 follow-up questions.' },
      ],
      own: false,
    },
    {
      text: 'The academies name the same topics differently.',
      quotes: [],
      own: true,
    },
  ],
  questions: [
    'Does a skipped question count as a wrong answer?',
    'Is the difficulty band measured from the missed question or from the student?',
  ],
  outOfScope: ['Grading essays.'],
  dropped: 1,
};

const needed: StudyState = { state: 'needed', token: 'a1b2c3d4e5f6a7b8', brief };
const confirmed: StudyState = {
  ...needed,
  state: 'confirmed',
  confirmedAt: '2026-10-30T15:00:00.000Z',
};
const plan: TaskPlan = { ...taskPlan, study: needed };

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

async function capture(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), animations: 'disabled' });
}

test('shows what the teacher understood, and trains only once the person confirms it', async () => {
  const { app, page } = launched;
  await stubEngine(app, {
    ...FLOW_ENGINE,
    'jobs:get': phil,
    'jobs:save': phil,
    'jobs:taskPlan': plan,
    'jobs:confirmStudy': confirmed,
  });
  await updateSettings(page, { onboarded: true, comparisonMode: false });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/jobs/${phil.id}/define`);

  const section = page.getByRole('region', { name: 'What Spark understood' });
  await expect(section).toBeVisible();
  const start = page.getByRole('button', { name: 'Start training' });
  await expect(start).toBeDisabled();
  await expect(page.getByText('Confirm the brief first', { exact: true })).toBeVisible();

  const card = section.getByRole('article', { name: 'The brief' });
  await expect(card.getByText('Assign practice', { exact: true })).toBeVisible();
  await expect(card.getByText('Does a skipped question count as a wrong answer?')).toBeVisible();
  // The passages wait behind a disclosure, each with the academy and the file it is in.
  const passages = card.getByRole('button', { name: '2 passages' }).first();
  await passages.click();
  await expect(card.getByText('Northside Prep, policy.md').first()).toBeVisible();
  // A claim no passage backs is marked as the teacher's own.
  await expect(card.getByRole('img', { name: "Spark's own reading" }).first()).toBeVisible();
  // Nothing of the academy kept for the final test is on the page.
  await expect(page.getByText(/Harbor/)).toHaveCount(0);
  await capture(page, 'study-define-dark');

  await section.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(section.getByText('Confirmed on Oct 30')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Confirm and continue' })).toHaveCount(0);
  // Nothing waits now; what is said beside Start training is that the time limit cuts it short.
  await expect(start).toBeEnabled();
  await expect(page.getByText(/^The 20-hour limit fits .* of 12 rounds$/)).toBeVisible();
  await expect(start).toBeEnabled();
});
