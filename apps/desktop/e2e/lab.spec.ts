import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import { stubFields } from './fixtures-fields';
import { LAB, stubLab } from './fixtures-lab';
import { installModelsFake } from './fixtures-models';
import { CHATS } from './fixtures-workspace';
import { STORY } from './story';

/*
 * The Lab and Architect's places against the stand-in engine (decision 073): a fresh install's
 * ways in; what needs the person, what runs, what finished on organizations seen, unseen and
 * real, what it cost, the fields and the agents; and each place the sidebar leads to.
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

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

async function reloadAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

const places = () => page.getByRole('navigation', { name: 'Places' });
const card = (name: string) => page.getByRole('region', { name });

test('offers the ways in on a fresh install', async () => {
  await stubEngine(launched.app, EMPTY_ENGINE);
  await reloadAt('/');
  await expect(page.getByRole('heading', { name: 'Lab', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nothing in the lab yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Describe a field' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the tutor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the sample job' })).toBeVisible();
  await expect(places().getByRole('button', { name: 'Lab' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await capture('lab-empty-dark.png');

  await page.getByRole('button', { name: 'Describe a field' }).click();
  await expect(page).toHaveURL(/#\/new$/);
});

test('shows what needs the person and what runs, then what finished, spent and serves', async () => {
  await stubLab(launched.app);
  await reloadAt('/');

  const needs = card('Needs you');
  await expect(
    needs.getByRole('button', { name: /Returns desk.*A question for you/ }),
  ).toBeVisible();
  await expect(needs.getByRole('button', { name: /Clinic intake.*Results ready/ })).toBeVisible();
  await expect(
    needs.getByRole('button', { name: /Invoice and book Cedar Ave.*approval/ }),
  ).toBeVisible();
  await expect(needs.getByRole('button', { name: /A lesson to review/ })).toBeVisible();
  // The new version beside the active one, so a lower score is never offered as the better one.
  await expect(
    needs.getByRole('button', {
      name: /Version 3: 88% on check tasks, active version 2: 94%/,
    }),
  ).toBeVisible();
  for (const group of ['Questions', 'Results', 'Approvals', 'Lessons', 'Versions']) {
    await expect(needs.getByRole('region', { name: group })).toBeVisible();
  }
  await expect(needs.getByText('Nothing waits for you')).toBeHidden();

  const running = card('Running');
  await expect(running.getByRole('button', { name: /Service desk/ })).toContainText(
    'Diagnosing, round 5 of 12',
  );
  await expect(running.getByRole('button', { name: /Parts counter/ })).toContainText('53%');

  // Phil was tested on the academies it trained on, on one it never saw and on a real one.
  const finished = card('Recently finished');
  const phil = finished.getByRole('button', { name: /^Phil/ });
  await expect(phil).toContainText('Taught on');
  await expect(phil).toContainText('Never seen');
  await expect(phil).toContainText('Real');
  await expect(phil).toContainText('90%');
  await expect(finished.getByRole('button', { name: /Clinic intake/ })).toContainText('92%');

  // Spark's spending against each run's cap; the part counter's is near its cap.
  const spend = card('Spend');
  await expect(spend.getByRole('meter', { name: 'Phil, Spark' })).toHaveAttribute(
    'aria-valuetext',
    '$2.84 of $5.00',
  );
  await expect(spend).toContainText('$0.61');

  await expect(card('Fields').getByRole('button', { name: /Phil.*3 organizations/ })).toBeVisible();
  // The versions Models lists as active.
  await expect(
    card('Agents').getByRole('button', { name: 'Open Phil', exact: true }),
  ).toContainText('Version 2');
  await capture('lab-dark.png');
  await card('Agents').scrollIntoViewIfNeeded();
  await capture('lab-lower-dark.png');

  // Each row opens what it is about.
  await needs.getByRole('button', { name: /Returns desk/ }).click();
  await expect(page).toHaveURL(/#\/runs\/run_returns\/train$/);
  await goTo(page, '/');
  await phil.click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${LAB.philRun}/report$`));
  await goTo(page, '/');
  await card('Agents').getByRole('button', { name: 'Open Service desk' }).click();
  await expect(page).toHaveURL(new RegExp(`#/agents/${STORY.graduateId}/chats/${CHATS.fresh.id}$`));
  await goTo(page, '/');
  await needs.getByRole('button', { name: /A lesson to review/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Teaching');
  await page.keyboard.press('Escape');
});

test('leads to each place from the sidebar and the command palette', async () => {
  await stubFields(launched.app);
  await reloadAt('/');

  await places().getByRole('button', { name: 'Fields' }).click();
  await expect(page).toHaveURL(/#\/fields$/);
  const fields = page.getByRole('table', { name: 'Fields' });
  await expect(fields.getByRole('row', { name: /Phil/ })).toContainText('3');
  await fields.getByRole('row', { name: /Phil/ }).click();
  await expect(page).toHaveURL(new RegExp(`#/fields/${LAB.philJob}$`));
  await expect(page.getByRole('heading', { name: 'Phil', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Organizations' })).toBeVisible();

  await places().getByRole('button', { name: 'Experiments' }).click();
  await expect(page.getByRole('heading', { name: 'No experiments yet' })).toBeVisible();
  await capture('places-experiments-dark.png');
  await page.getByRole('button', { name: 'New experiment' }).click();
  await expect(page).toHaveURL(/#\/experiments\/new$/);
  await expect(places().getByRole('button', { name: 'Experiments' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await goTo(page, '/experiments/exp_gone');
  await expect(page.getByRole('heading', { name: "This experiment isn't here" })).toBeVisible();

  // Models reads every version of every agent; its own spec covers it (models.spec.ts).
  await installModelsFake(launched.app);
  await places().getByRole('button', { name: 'Models' }).click();
  const models = page.getByRole('table', { name: 'Models' });
  // Sorted by name; a click on a header sorts by it, again the other way.
  await expect(models.getByRole('row').nth(2)).toContainText('Phil');
  await models.getByRole('button', { name: 'Agent' }).click();
  await expect(models.getByRole('row').nth(2)).toContainText('Service desk');
  await models.getByRole('button', { name: 'Agent' }).click();
  await capture('places-models-dark.png');

  await places().getByRole('button', { name: 'Compute' }).click();
  await expect(page.getByRole('region', { name: 'Training plan' })).toBeVisible();
  await capture('places-compute-dark.png');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('option', { name: 'Fields' }).click();
  await expect(page).toHaveURL(/#\/fields$/);
});
