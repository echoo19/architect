import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Qualification } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { ACADEMY_DESK_CERTIFICATE } from './fixtures-certify';
import {
  ACADEMY_DESK_ASSETS,
  ACADEMY_DESK_FIELD,
  FIELD_REPORTS,
  FIELDS,
  stubFields,
} from './fixtures-fields';
import { stubByKey, stubRecorded } from './fixtures-flow';
import { LAB } from './fixtures-lab';
import { installModelsFake } from './fixtures-models';
import { academyVersion, ACADEMY_RUN, at } from './story';

/*
 * A field's life as one timeline on its Overview (decision 091), against the stand-in engine:
 * Academy desk studied, taught three times (version 1, Academy desk Mini, then version 2), each
 * version given its final test, the first one certified, version 2 tested on an academy added
 * later and beside a model trained elsewhere, an experiment running and the field exported in
 * this session. Each row leads to the place that holds it, and the one thing missing, a
 * certificate for the best version, closes the line.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const EXPORT_DIR = 'C:\\Users\\dana\\Exports\\academy-desk';

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

/** The first version's card, certified when it was tested. */
const EARLIER = { ...FIELD_REPORTS[FIELDS.earlierRun], certificate: ACADEMY_DESK_CERTIFICATE };

const TRAINED_ELSEWHERE: Qualification = {
  id: 'qlf_1',
  runId: LAB.academyDeskRun,
  jobId: LAB.academyDeskJob,
  harnessVersion: academyVersion(ACADEMY_RUN),
  model: 'academy-desk-sft-8b',
  baseUrl: 'http://127.0.0.1:8080/v1',
  status: 'finished',
  card: FIELD_REPORTS[LAB.academyDeskRun],
  startedAt: at(3_600),
  endedAt: at(3_700),
};

async function stubTimeline(): Promise<void> {
  await installModelsFake(launched.app);
  await stubFields(launched.app);
  await stubByKey(launched.app, 'reports:get', {
    ...FIELD_REPORTS,
    [FIELDS.earlierRun]: EARLIER,
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

  await expect(entries()).toHaveCount(13);
  const texts = await entries().allInnerTexts();
  // An entry reads its date, its sentence and its place, with no stage word under it; the next
  // step has no date, and says it is the next step.
  const rows = texts
    .map((text) => text.split('\n').filter(Boolean))
    .map((line, index, all) => (index === all.length - 1 ? line : line.slice(1)));
  const sentences = rows.map((row) => row[0]);
  expect(sentences).toEqual([
    'You confirmed the study of 3 organizations: 6 skills and 3 rules',
    'Trained 4 rounds and kept 3 changes',
    'Academy desk v1 took its sealed final test: 85% taught on, 67% never seen and 80% real',
    'Academy desk v1 was issued a risk certificate: risk bound 8% on the answers it gives, and it held on 1 of the 2 organizations it never saw',
    'Trained 5 rounds and kept 4 changes',
    'Academy desk Mini v1 took its sealed final test: 94% taught on, 86% never seen and 90% real',
    expect.stringMatching(
      /^Trained 6 rounds, kept 4 changes and added \d+ counterexamples? to the regression suite$/,
    ),
    'Academy desk v2 took its sealed final test: 93% taught on, 83% never seen and 90% real',
    'Comparing 3 arms in “Targeted against one-shot draft”',
    'Academy desk v2 was tested on Maple Grove Academy, added later and never seen: 83%',
    expect.stringMatching(
      /^academy-desk-sft-8b, fine-tuned elsewhere, took the sealed final test with harness v7:/,
    ),
    "Exported the field's fine-tuning data to …\\Exports\\academy-desk",
    'Issue a risk certificate for the best version',
  ]);
  expect(rows.map((row) => row.length)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3]);
  expect(rows.at(-1)?.[1]).toBe('Next step');
  expect(rows.map((row) => row.at(-1))).toEqual([
    'Study',
    'Results',
    'Results',
    'Models',
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
  await open(3, /#\/models\/.+/);
  await open(8, /#\/experiments\/cmp_targeted$/);
  await open(10, new RegExp(`#/compute/fields/${LAB.academyDeskJob}$`));
  await open(12, /#\/models\/.+/);

  await goTo(page, `/fields/${LAB.academyDeskJob}`);
  await entries().nth(9).getByRole('button').click();
  await expect(page.getByRole('tab', { name: 'Organizations' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
