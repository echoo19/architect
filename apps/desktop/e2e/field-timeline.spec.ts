import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Qualification, ReportCard, Run } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { ACADEMY_DESK_CERTIFICATE } from './fixtures-certify';
import { FIELD_REPORT } from './fixtures-field';
import {
  ACADEMY_DESK_ASSETS,
  ACADEMY_DESK_FIELD,
  ACADEMY_DESK_PLAN,
  FIELDS,
  stubFields,
} from './fixtures-fields';
import { stubByKey, stubRecorded } from './fixtures-flow';
import { ACADEMY_DESK_ID, LAB } from './fixtures-lab';
import { installModelsFake, MODEL_VERSIONS } from './fixtures-models';
import { at, makeRun } from './story';

/*
 * A field's life as one timeline on its Overview (decision 091), against the stand-in engine:
 * Academy desk studied, taught twice, each version given its final test, the earlier one
 * certified, the best one tested on an academy added later and beside a model trained elsewhere,
 * an experiment running and the field exported in this session. Each row leads to the place that
 * holds it, and the one thing missing, a certificate for the best version, closes the line.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const EXPORT_DIR = 'C:\\Users\\dana\\Exports\\academy-desk';

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

const run = (id: string, createdAt: string, endedAt: string, version: number, rounds: number) =>
  makeRun({
    id,
    jobId: LAB.academyDeskJob,
    status: 'finished',
    phase: 'done',
    createdAt,
    updatedAt: endedAt,
    endedAt,
    currentVersion: version,
    totals: { ...makeRun({}).totals, rounds },
    ...(id === LAB.academyDeskRun ? { graduateId: ACADEMY_DESK_ID } : {}),
  });

const RUNS: Run[] = [
  run(LAB.academyDeskRun, at(-600), at(110), 9, 7),
  run(FIELDS.earlierRun, at(-2_800), at(-1_500), 6, 5),
];

const BEST: ReportCard = {
  ...FIELD_REPORT,
  jobId: LAB.academyDeskJob,
  runId: LAB.academyDeskRun,
  name: 'Academy desk',
  createdAt: at(120),
};

/** The earlier version, one fewer pass at each organization, certified when it was tested. */
const EARLIER: ReportCard = {
  ...FIELD_REPORT,
  jobId: LAB.academyDeskJob,
  runId: FIELDS.earlierRun,
  createdAt: at(-1_440),
  test: {
    ...FIELD_REPORT.test,
    score: { pass: FIELD_REPORT.test.score.pass - 6, total: FIELD_REPORT.test.score.total },
    perOrg: FIELD_REPORT.test.perOrg?.map((row) => ({ ...row, pass: Math.max(0, row.pass - 1) })),
  },
  certificate: ACADEMY_DESK_CERTIFICATE,
};

const TRAINED_ELSEWHERE: Qualification = {
  id: 'qlf_1',
  runId: LAB.academyDeskRun,
  jobId: LAB.academyDeskJob,
  harnessVersion: 9,
  model: 'academy-desk-sft-8b',
  baseUrl: 'http://127.0.0.1:8080/v1',
  status: 'finished',
  card: BEST,
  startedAt: at(3_600),
  endedAt: at(3_700),
};

async function stubTimeline(): Promise<void> {
  await installModelsFake(launched.app);
  await stubFields(launched.app);
  await stubByKey(launched.app, 'graduates:versions', {
    ...MODEL_VERSIONS,
    [ACADEMY_DESK_ID]: (MODEL_VERSIONS[ACADEMY_DESK_ID] ?? []).map((version) =>
      version.version === 2 ? { ...version, runId: LAB.academyDeskRun } : version,
    ),
  });
  await stubByKey(launched.app, 'runs:list', { [LAB.academyDeskJob]: RUNS });
  await stubByKey(launched.app, 'reports:get', {
    [LAB.academyDeskRun]: BEST,
    [FIELDS.earlierRun]: EARLIER,
  });
  await stubByKey(launched.app, 'jobs:taskPlan', {
    [LAB.academyDeskJob]: {
      ...ACADEMY_DESK_PLAN,
      study: { ...ACADEMY_DESK_PLAN.study, confirmedAt: at(-2_880) },
    },
  });
  await stubByKey(launched.app, 'jobs:field', {
    [LAB.academyDeskJob]: {
      ...ACADEMY_DESK_FIELD,
      qualifications: [
        {
          runId: LAB.academyDeskRun,
          org: 'Maple Grove Academy',
          status: 'finished',
          startedAt: at(3_500),
          endedAt: at(3_560),
          score: { pass: 25, total: 30 },
        },
      ],
    },
  });
  await stubByKey(launched.app, 'runs:qualifications', {
    [LAB.academyDeskJob]: [TRAINED_ELSEWHERE],
  });
}

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
  await stubTimeline();
});

test.afterAll(async () => {
  await launched?.close();
});

const timeline = () => page.getByRole('list', { name: 'Timeline' });
const entries = () => timeline().getByRole('listitem');

test("tells the field's life oldest first, from its records, and ends on the one thing missing", async () => {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/fields/${LAB.academyDeskJob}`);

  // The export is this session's: written from Assets, then read back on the Overview.
  await page.getByRole('tab', { name: 'Assets' }).click();
  await stubEngine(launched.app, { 'files:pick': [EXPORT_DIR] });
  await stubRecorded(launched.app, 'jobs:exportField', ACADEMY_DESK_ASSETS);
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Field exported', { exact: true })).toBeVisible();
  await expect(page.getByText('Field exported', { exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.getByRole('tab', { name: 'Overview' }).click();

  await expect(entries()).toHaveCount(11);
  const texts = await entries().allInnerTexts();
  // An entry reads its date, its sentence, its stage and its place; the next step has no date.
  const rows = texts
    .map((text) => text.split('\n').filter(Boolean))
    .map((line) => (line.length === 4 ? line.slice(1) : line));
  const sentences = rows.map((row) => row[0]);
  expect(sentences).toEqual([
    'You confirmed the study of 3 organizations: 6 skills and 3 rules',
    expect.stringMatching(/^Trained 5 rounds and kept \d+ changes?$/),
    expect.stringMatching(
      /^Harness v6 took its final test: \d+% taught on, \d+% never seen and \d+% real$/,
    ),
    'Harness v6 was certified: wrong on at most 8% of the answers it gives, and it held on 1 of the 2 organizations it never saw',
    expect.stringMatching(/^Trained 7 rounds, kept \d+ changes? and found \d+ counterexamples?$/),
    expect.stringMatching(
      /^Academy desk v2 took its final test: \d+% taught on, 83% never seen and 90% real$/,
    ),
    'Comparing 3 arms in “Targeted against one-shot draft”',
    'Academy desk v2 was tested on Maple Grove Academy, added later and never seen: 83%',
    expect.stringMatching(
      /^academy-desk-sft-8b, trained elsewhere, took the final test with harness v9:/,
    ),
    "Exported the field's training examples to …\\Exports\\academy-desk",
    'Certify the best version',
  ]);
  expect(rows.map((row) => row[1])).toEqual([
    'Studied',
    'Taught',
    'Tested',
    'Certified',
    'Taught',
    'Tested',
    'Compared',
    'Tested',
    'Tested',
    'Exported',
    'Next step',
  ]);
  expect(rows.map((row) => row[2])).toEqual([
    'Study',
    'Results',
    'Results',
    'Results',
    'Results',
    'Results',
    'Experiments',
    'Organizations',
    'Compute',
    'Compute',
    'Models',
  ]);

  await page
    .getByRole('region', { name: 'Timeline' })
    .evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, 'field-timeline-dark.png'),
    animations: 'disabled',
    timeout: 15_000,
  });
});

test('each entry leads to the place that holds it', async () => {
  const open = async (index: number, url: RegExp) => {
    await goTo(page, `/fields/${LAB.academyDeskJob}`);
    await entries().nth(index).getByRole('button').click();
    await expect(page).toHaveURL(url);
  };
  await open(0, new RegExp(`#/jobs/${LAB.academyDeskJob}/define$`));
  await open(2, new RegExp(`#/runs/${FIELDS.earlierRun}/report$`));
  await open(6, /#\/experiments\/cmp_targeted$/);
  await open(8, new RegExp(`#/compute/fields/${LAB.academyDeskJob}$`));
  await open(10, /#\/models\/.+/);

  await goTo(page, `/fields/${LAB.academyDeskJob}`);
  await entries().nth(7).getByRole('button').click();
  await expect(page.getByRole('tab', { name: 'Organizations' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
