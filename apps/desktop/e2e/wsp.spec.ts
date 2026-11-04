import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import {
  stubWsp,
  WSP_BRIEF,
  WSP_BRIEFING,
  WSP_DRAFT_FAILED,
  WSP_EVALUATED,
  WSP_EXAMPLES,
  WSP_INTERRUPTED,
  WSP_MENTOR_MISSING,
  WSP_QUALIFIED,
  WSP_RUNNING,
  WSP_STAND_IN_EVALUATED,
} from './fixtures-wsp';

/*
 * Architect WSP, the experimental third edition (decision 109), against stubbed engine replies:
 * choosing it on the welcome screen and in Settings, its sidebar, a new experiment from its model
 * to Start experiment, and an experiment running, evaluated, qualified and on a stand-in mentor.
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
  await stubEngine(launched.app, EMPTY_ENGINE);
  await stubWsp(launched.app);
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

const edition = () => page.evaluate(() => window.architect.settings.get().then((s) => s.edition));
const sidebar = () => page.getByRole('complementary');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Why a step's way on is held, from the line beside it, or null when it isn't held. */
async function heldBy(name: string): Promise<string | null> {
  const button = page.getByRole('button', { name, exact: true });
  if (await button.isEnabled()) return null;
  const why = await button.getAttribute('aria-describedby');
  return why === null ? null : page.locator(`[id="${why}"]`).innerText();
}

test('the welcome screen offers Architect WSP as a third edition, marked experimental', async () => {
  await goTo(page, '/');
  await expect(page).toHaveURL(/#\/welcome$/);
  const choice = page.getByRole('radiogroup', { name: 'Edition' });
  const wsp = choice.getByRole('radio', { name: /Architect WSP/ });
  await expect(choice.getByRole('radio')).toHaveCount(3);
  await expect(wsp).toContainText('Experimental');
  await wsp.click();
  await expect.poll(edition).toBe('wsp');
  await expect(page.getByRole('list', { name: 'Setup' }).getByRole('listitem')).toHaveCount(1);
  await capture('wsp-welcome.png');

  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Experiments', level: 1 })).toBeVisible();
  await expect(sidebar().getByText('Architect WSP', { exact: true })).toBeVisible();
  await expect(sidebar().getByText('Experimental', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Places' }).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Agents' })).toHaveCount(0);
  expect(await page.title()).toBe('Architect WSP');
  const table = page.getByRole('table', { name: 'Experiments' });
  await expect(table.getByRole('row')).toHaveCount(9);
  await expect(table).toContainText('Qwen3-0.6B');
  await capture('wsp-home.png');
});

test('Settings switches between all three editions, and each keeps to its own routes', async () => {
  await page.keyboard.press(`${mod}+,`);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const choice = settings.getByRole('radiogroup', { name: 'Edition' });
  await expect(choice.getByRole('radio', { name: /Architect WSP/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(choice.getByRole('radio', { name: /Architect WSP/ })).toContainText('Experimental');
  await capture('wsp-settings.png');
  await choice.getByRole('radio', { name: 'Architect Lab' }).click();
  await expect.poll(edition).toBe('lab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Lab', level: 1 })).toBeVisible();
  await goTo(page, '/wsp/new');
  await expect(page).toHaveURL(/#\/$/);

  await updateSettings(page, { edition: 'wsp' });
  await expect(page.getByRole('heading', { name: 'Experiments', level: 1 })).toBeVisible();
  for (const path of ['/models', '/new', '/fields', '/agents/grd_1']) {
    await goTo(page, path);
    await expect(page).toHaveURL(/#\/$/);
  }

  await page.keyboard.press(`${mod}+k`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette.getByRole('option', { name: 'New experiment' })).toBeVisible();
  await expect(palette.getByRole('option', { name: 'New agent' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('a new experiment goes from its model to Start experiment', async () => {
  await goTo(page, '/wsp/new');
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(page.getByRole('heading', { name: 'Which model?' })).toBeVisible();
  await expect(
    page.getByText('Read only: nothing is ever written to the original checkpoint.'),
  ).toBeVisible();
  const models = page.getByRole('table', { name: 'Models' });
  await expect(models).toContainText('Qwen/Qwen3-0.6B@');
  await expect(models).toContainText('No .safetensors weights');
  expect(await heldBy('Continue')).toBe('Choose a supported model');
  // An unsupported model can't be chosen.
  await models.getByRole('row').filter({ hasText: 'qwen3-0.6b-gguf' }).click();
  await expect(continueButton).toBeDisabled();
  await capture('wsp-new-model.png');
  await models.getByRole('row').filter({ hasText: 'Qwen/Qwen3-0.6B@' }).click();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page.getByRole('heading', { name: 'What should change?' })).toBeVisible();
  expect(await heldBy('Continue')).toBe('Describe the goal');
  await page
    .getByLabel('Goal', { exact: true })
    .fill('Stop repeating the same sentence in long answers');
  const lines = [...WSP_EXAMPLES.map((example) => JSON.stringify(example)), 'not json'];
  await page.getByLabel('JSONL file of examples').setInputFiles({
    name: 'examples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(lines.join('\n')),
  });
  await expect(page.getByRole('group', { name: 'Example 24' })).toBeVisible();
  await expect(page.getByText(/1 line was left out: line 25 \(Not JSON\)/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Examples' })).toContainText(
    '10 practice, 7 dev, 7 sealed',
  );
  await expect(continueButton).toBeEnabled();
  await capture('wsp-new-goal.png');
  await continueButton.click();

  await expect(page.getByRole('heading', { name: 'Where it runs, and its limits' })).toBeVisible();
  const compute = page.getByRole('radiogroup', { name: 'Compute' });
  await expect(compute.getByRole('radio', { name: /This computer/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(compute.getByRole('radio', { name: /Slurm/ })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Readiness' })).toContainText('GPT-6 Astra');
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(
    page.getByRole('radiogroup', { name: 'Reasoning effort' }).getByRole('radio'),
  ).toHaveCount(3);
  await capture('wsp-new-compute.png');
  await page.getByRole('button', { name: 'Draft brief' }).click();

  await expect(page).toHaveURL(new RegExp(`#/wsp/${WSP_BRIEF.id}$`));
  await expect(page.getByRole('heading', { name: 'The brief' })).toBeVisible();
  const objective = page.getByLabel('Objective', { exact: true });
  await expect(objective).toHaveValue(WSP_BRIEF.brief?.objective ?? '');
  await expect(page.getByRole('region', { name: 'Budget' })).toContainText('8');
  await capture('wsp-brief.png');
  await objective.fill('');
  expect(await heldBy('Start experiment')).toBe('Fill in the objective');
  await objective.fill('Cut loops in long answers.');
  await page.getByLabel('Title', { exact: true }).click();
  await page.getByRole('button', { name: 'Start experiment' }).click();
  await expect(page.getByRole('heading', { name: WSP_BRIEF.title, level: 1 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Stages' })).toBeVisible();
});

test('a brief being drafted, and one whose draft failed, say so', async () => {
  await goTo(page, `/wsp/${WSP_BRIEFING.id}`);
  await expect(page.getByText('GPT-6 Astra is drafting the brief')).toBeVisible();
  expect(await heldBy('Start experiment')).toBe('The brief is being drafted');
  await capture('wsp-briefing.png');
  await goTo(page, `/wsp/${WSP_DRAFT_FAILED.id}`);
  await expect(page.getByText("The brief couldn't be drafted")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draft again' })).toBeVisible();
});

test('the compute step holds the draft until the mentor has a key', async () => {
  await stubWsp(launched.app, { mentor: WSP_MENTOR_MISSING });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/wsp/new');
  await page
    .getByRole('table', { name: 'Models' })
    .getByRole('row')
    .filter({ hasText: 'Qwen/Qwen3-0.6B@' })
    .click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Goal', { exact: true }).fill('Stop loops');
  await page.getByLabel('JSONL file of examples').setInputFiles({
    name: 'examples.jsonl',
    mimeType: 'application/jsonl',
    buffer: Buffer.from(WSP_EXAMPLES.map((example) => JSON.stringify(example)).join('\n')),
  });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Add a key' })).toBeVisible();
  expect(await heldBy('Draft brief')).toBe('Add a key for GPT-6 Astra');
  await stubWsp(launched.app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test('a running experiment shows its stage, hypothesis, budget and programs', async () => {
  await goTo(page, `/wsp/${WSP_RUNNING.id}`);
  await expect(page.getByRole('heading', { name: WSP_RUNNING.title, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Stages' }).locator('[aria-current="step"]'),
  ).toHaveText('Proposed edit');
  await expect(page.getByRole('region', { name: "GPT-6 Astra's hypothesis" })).toContainText(
    'layer 25 head 2',
  );
  const programs = page.getByRole('table', { name: 'Programs' });
  await expect(programs.getByRole('row')).toHaveCount(4);
  await expect(programs).toContainText('Refused');
  await expect(programs).toContainText('Kept');
  await expect(page.getByText('Measured on qualification')).toHaveCount(0);
  await capture('wsp-running.png');

  await programs.getByRole('row').filter({ hasText: 'Damping the value projection' }).click();
  const drawer = page.getByRole('dialog', { name: 'Program 2' });
  await expect(drawer.getByLabel('Program source')).toContainText('v_proj');
  await expect(drawer).toContainText('scaled v_proj rows 320-383');
  await capture('wsp-program.png');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('an evaluated experiment reads its result, and offers qualification', async () => {
  await goTo(page, `/wsp/${WSP_EVALUATED.id}`);
  await expect(page.getByText('Not established', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Qualify' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export checkpoint' })).toBeVisible();
  await expect(page.getByRole('figure', { name: /Candidate against each arm/ })).toContainText(
    'vs Base, loop rate',
  );
  await expect(page.getByText('Qualification', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Not compared' })).toContainText('Fine-tuning');
  await expect(page.getByRole('region', { name: 'Candidate', exact: true })).toContainText(
    'Not verified on a local runtime',
  );
  await expect(page.getByRole('note')).toHaveCount(0);
  await capture('wsp-evaluated.png');
});

test("a stand-in mentor's run says plainly that it is not a result", async () => {
  await goTo(page, `/wsp/${WSP_STAND_IN_EVALUATED.id}`);
  await expect(page.getByRole('note')).toContainText('Stand-in mentor');
  await expect(page.getByRole('note')).toContainText('nothing it finds is a result');
  await expect(page.getByRole('note').getByRole('button')).toHaveCount(0);
  await expect(page.getByText('Improved', { exact: true })).toBeVisible();
  await capture('wsp-stand-in.png');
});

test('a qualified experiment adds what the sealed examples measured', async () => {
  await goTo(page, `/wsp/${WSP_QUALIFIED.id}`);
  await expect(page.getByRole('heading', { name: 'Measured on qualification' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Qualify' })).toHaveCount(0);
  await expect(page.getByRole('figure', { name: /Candidate against each arm/ })).toContainText(
    'Qualification',
  );
  await capture('wsp-qualified.png');
});

test('an interrupted experiment can be resumed', async () => {
  await goTo(page, `/wsp/${WSP_INTERRUPTED.id}`);
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
});
