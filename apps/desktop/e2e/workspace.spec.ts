import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import {
  AGENT,
  CHATS,
  callsTo,
  emitPullProgress,
  emitWorkspace,
  engineSeed,
  finishPull,
  GB,
  installFakeEngine,
  pricingReply,
  STUDENT_MODEL,
  updateChat,
  type EngineSeed,
} from './fixtures-workspace';

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

const chatPath = (chatId: string) => `/agents/${AGENT.id}/chats/${chatId}`;

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
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  // Off every control, so no hover state or tooltip lands in the picture.
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

/** A fresh fake engine, the theme and setup state, then the app reloaded at `path`. */
async function open(
  theme: Theme,
  path: string,
  options: { onboarded?: boolean; seed?: EngineSeed } = {},
): Promise<void> {
  await installFakeEngine(launched.app, options.seed ?? engineSeed());
  await updateSettings(page, { theme, onboarded: options.onboarded ?? true });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await goTo(page, path);
}

for (const theme of THEMES) {
  test(`walks through first-run setup while the model downloads (${theme})`, async () => {
    const app = launched.app;
    await open(theme, '/welcome', {
      onboarded: false,
      seed: engineSeed({ graduates: [], chats: [], messages: [] }),
    });
    await expect(page.getByRole('heading', { name: 'Welcome to Architect' })).toBeVisible();
    await expect(page.getByText('Running · 0.12.6')).toBeVisible();
    const fourBit = page.getByRole('radio', { name: /Muse Glimmer 4-bit/ });
    const twoBit = page.getByRole('radio', { name: /Muse Glimmer 2-bit/ });
    await expect(fourBit).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: /^Download ·/ }).click();
    await expect.poll(() => callsTo(app, 'ollama:install')).toEqual([['glimmer-4bit']]);
    await emitPullProgress(app, { model: STUDENT_MODEL, status: 'pulling manifest', done: false });
    await emitPullProgress(app, {
      model: STUDENT_MODEL,
      status: 'pulling 3f2ad1c8e7b1',
      completedBytes: 4.2 * GB,
      totalBytes: 18 * GB,
      done: false,
    });
    const progress = page.getByRole('progressbar', { name: 'Downloading Muse Glimmer · 4-bit' });
    await expect(progress).toHaveAttribute('aria-valuenow', '23');
    await expect(page.getByText('4.2 GB of 18 GB')).toBeVisible();
    // The other build waits until this download is done.
    await expect(twoBit).toBeDisabled();
    await capture(`welcome-download-${theme}.png`);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a mentor' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Muse Spark/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
    await capture(`welcome-mentor-${theme}.png`);
    const key = page.getByLabel('Meta API key');
    await key.fill('not-a-real-key');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connected · 640 ms')).toBeVisible();
    await expect(key).toHaveValue('');
    expect(await callsTo(app, 'secrets:set')).toEqual([['meta']]);
    expect(await callsTo(app, 'connections:testMentor')).toEqual([
      [expect.objectContaining({ model: 'muse-spark-1.3', secretRef: 'meta' })],
    ]);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Faster training' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await capture(`welcome-hosted-${theme}.png`);
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByRole('heading', { name: "You're set up" })).toBeVisible();
    await expect(page.getByText('Downloading · 23%')).toBeVisible();
    await emitPullProgress(app, { model: STUDENT_MODEL, status: 'success', done: true });
    await finishPull(app);
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await capture(`welcome-done-${theme}.png`);

    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('button', { name: 'Try the sample job' })).toBeVisible();
    expect(await page.evaluate(() => window.architect.settings.get())).toMatchObject({
      onboarded: true,
    });
  });
}

for (const theme of THEMES) {
  test(`streams steps and an answer with a table (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.fresh.id));
    const suggestions = page.getByRole('group', { name: 'Things to ask Service desk' });
    await expect(suggestions.getByRole('button')).toHaveText([
      'Price a finished job and add its invoice',
      'Find who owes money after partial payments',
      'Book the earliest technician who can do the job',
    ]);
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Glimmer', { exact: true })).toBeVisible();
    await expect(page.getByText('Private from Spark')).toHaveCount(0);
    await expect(page.getByText('Running on this computer')).toBeVisible();
    await capture(`workspace-new-chat-${theme}.png`);

    await suggestions
      .getByRole('button', { name: 'Price a finished job and add its invoice' })
      .click();
    const composer = page.getByRole('textbox', { name: 'Message Service desk' });
    await expect(composer).toHaveValue('Price a finished job and add its invoice');
    const request = 'Price the two jobs Dana finished today and tell me the totals.';
    await composer.fill(request);
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    await expect(page.getByRole('article', { name: 'You' })).toHaveText(request);
    expect(await callsTo(app, 'workspace:send')).toEqual([[CHATS.fresh.id, request]]);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toBeVisible();

    // While Architect checks an agent on the GPU, the reply waits its turn and says so in one
    // quiet step, which goes once the reply starts.
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('waiting') });
    const waiting = page.getByRole('button', {
      name: 'Waiting: your computer is busy with another job.',
    });
    await expect(waiting).toBeVisible();
    await capture(`workspace-gpu-wait-${theme}.png`);
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('started') });
    await expect(page.getByRole('button', { name: /Reading data\/jobs\.csv/ })).toBeVisible();
    await expect(waiting).toBeHidden();
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('working') });
    // Tool steps start folded, as the setting says, and open on a click.
    const current = page.getByRole('button', { name: /invoice_total job J-4471 · 4 steps/ });
    await expect(current).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name: 'Steps' })).toBeHidden();
    await current.click();
    const steps = page.getByRole('list', { name: 'Steps' });
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    // The table read shows its first rows, and code shows folded with what it gave back.
    const jobs = steps.getByRole('table', { name: 'data/jobs.csv' });
    await expect(jobs.getByRole('row')).toHaveCount(5);
    await expect(jobs).toContainText('J-4471');
    const code = steps.getByRole('button', { name: 'Code' });
    await expect(code).toHaveAttribute('aria-expanded', 'false');
    await expect(steps).toContainText('"name":"Dana R."');
    await capture(`workspace-streaming-${theme}.png`);
    await code.click();
    await expect(code).toHaveAttribute('aria-expanded', 'true');
    await expect(steps).toContainText("technicians.find((tech) => tech.technician_id === 'T-04')");
    await steps.getByRole('button', { name: 'Show all 5 rows' }).click();
    const read = page.getByRole('complementary', { name: 'data/jobs.csv' });
    await expect(read.getByRole('row')).toHaveCount(6);
    await page.keyboard.press('Escape');
    await expect(read).toBeHidden();

    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('writing') });
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('done') });
    await updateChat(app, CHATS.fresh.id, { running: false });
    // The steps stay as the reader left them; one more click folds them.
    const worked = page.getByRole('button', { name: 'Worked for 2 min 21 s · 5 steps' });
    await expect(worked).toHaveAttribute('aria-expanded', 'true');
    await worked.click();
    await expect(page.getByRole('list', { name: 'Steps' })).toBeHidden();
    await expect(page.locator('strong', { hasText: '$524.03' })).toBeVisible();
    const breakdown = page.getByRole('table', { name: 'Price breakdown' });
    await expect(breakdown.getByRole('row')).toHaveCount(6);
    await expect(breakdown).toContainText('2 more rows: Plan discount, Tax');
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Price the two jobs Dana finished',
    );
    await capture(`workspace-chat-${theme}.png`);

    await page.getByRole('button', { name: 'Show all 6' }).click();
    const panel = page.getByRole('complementary', { name: 'Price breakdown' });
    await expect(panel.getByRole('row')).toHaveCount(7);
    await capture(`workspace-panel-${theme}.png`);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
}

for (const theme of THEMES) {
  test(`asks before writing, and records an allow and a deny (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.approvals.id));
    const invoices = page.getByRole('group', { name: 'Write to data/invoices.csv' });
    const booking = page.getByRole('group', { name: 'Write to data/bookings.csv' });
    const note = page.getByRole('group', { name: 'Write to output/visit-notes/B-3051.md' });

    // The rows show before anything can be allowed, and the reply waits for an answer.
    const preview = invoices.getByRole('table', { name: 'Rows this change writes' });
    await expect(preview.getByRole('row')).toHaveCount(3);
    await expect(preview).toContainText('Added');
    await expect(preview).toContainText('INV-4473');
    await expect(booking.getByRole('table', { name: 'Rows this change writes' })).toBeVisible();
    // Each card counts the rows its write touches, and says how far "always" reaches.
    await expect(invoices).toContainText('Add to');
    await expect(invoices).toContainText('2 new rows');
    await expect(booking).toContainText('1 new row');
    // A new text file shows its lines, marked as added.
    await expect(note).toContainText('Create');
    await expect(note).toContainText('6 lines');
    const lines = note.getByRole('table', { name: 'Lines this change writes' });
    await expect(lines.getByRole('row')).toHaveCount(6);
    await expect(lines).toContainText('Call ahead: the side gate is locked.');
    await expect(invoices.getByRole('button', { name: 'Allow saving from now on' })).toBeVisible();
    const waiting = page.getByRole('status').filter({ hasText: 'Waiting for your approval' });
    await expect(waiting).toBeVisible();
    await capture(`workspace-approval-${theme}.png`);

    await invoices.getByRole('button', { name: 'Allow once' }).click();
    await expect(invoices).toContainText('Allowed');
    await booking.getByRole('button', { name: 'Deny' }).click();
    await expect(booking).toContainText('Denied');
    await note.getByRole('button', { name: 'Allow once' }).click();
    await expect(note).toContainText('Allowed');
    await expect(page.getByRole('button', { name: 'Allow once' })).toHaveCount(0);
    await expect(waiting).toBeHidden();
    expect(await callsTo(app, 'workspace:decide')).toEqual([
      ['chg_invoices', 'approve'],
      ['chg_booking', 'deny'],
      ['chg_note', 'approve'],
    ]);
  });
}

for (const theme of THEMES) {
  test(`refuses a task type with the reason from the report card (${theme})`, async () => {
    await open(theme, chatPath(CHATS.refund.id));
    const refusal = page.getByRole('note');
    await expect(refusal).toContainText("Service desk doesn't handle refunds");
    await expect(refusal).toContainText("Its job says it won't issue refunds or credits");
    await expect(refusal).toContainText(
      'It can help with invoices, overdue balances or scheduling.',
    );
    await capture(`workspace-refusal-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`changes what the agent may write and opens its settings (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    const settingsButton = page.getByRole('button', { name: 'Service desk settings' });
    await settingsButton.click();
    const dialog = page.getByRole('dialog', { name: 'Service desk', exact: true });
    await expect(dialog.getByText('Prices finished jobs, finds overdue balances')).toBeVisible();
    // The name is the dialog's title, so no row offers a rename the app can't do.
    await expect(dialog.getByText('Name', { exact: true })).toHaveCount(0);
    // The setup is named by its version, as the Teaching tab and the status line name it, and its
    // final test is the score the Results tab and the versions list give for it.
    await expect(dialog.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Passed: 55 of 60 (92%)')).toBeVisible();
    await expect(dialog.getByText('Tasks it had never seen')).toBeVisible();
    // The model this computer runs it on, in a picker of the models here, with its tag beside.
    await expect(dialog.getByRole('button', { name: "Your agent's model" })).toHaveText(
      'Muse Glimmer · 4-bit',
    );
    await expect(dialog.getByText('4-bit · 18 GB on disk · muse-glimmer:30b')).toBeVisible();
    // This computer's checks sit apart from the author's final test.
    await expect(dialog.getByText('Works on this computer', { exact: true })).toBeVisible();
    await expect(dialog.getByText('All checks passed', { exact: true })).toBeVisible();
    await capture(`workspace-agent-general-${theme}.png`);

    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete Service desk?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(await callsTo(app, 'graduates:remove')).toEqual([]);

    await dialog.getByRole('tab', { name: 'Permissions' }).click();
    await expect(dialog.getByRole('radio', { name: 'Ask first' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(dialog.getByText('Shows each change and waits for your OK')).toBeVisible();
    await expect(dialog.getByText('Never, by design')).toBeVisible();
    await expect(dialog.getByText('invoices.csv, bookings.csv')).toBeVisible();
    // Each folder it works in, with the one this computer bound and a way to choose another.
    await expect(dialog.getByText('data/', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Change' })).toBeVisible();
    await capture(`workspace-agent-permissions-${theme}.png`);

    await dialog.getByRole('tab', { name: 'Results' }).click();
    await expect(dialog.getByText('92%')).toBeVisible();
    await expect(dialog.getByText("Its job says it won't issue refunds or credits")).toBeVisible();
    await capture(`workspace-agent-report-${theme}.png`);

    await dialog.getByRole('tab', { name: 'Permissions' }).click();
    await dialog.getByRole('radio', { name: 'Never' }).click();
    await expect(dialog.getByText("Can't change your files")).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Saving files: Never' }).click();
    const modes = page.getByRole('menu');
    await expect(modes.getByRole('menuitem')).toHaveCount(3);
    await expect(modes).toContainText('Shows each change and waits for your OK');
    await modes.getByRole('menuitem', { name: /Allow/ }).click();
    await expect(page.getByRole('button', { name: 'Saving files: Allow' })).toBeVisible();
    expect(await callsTo(app, 'graduates:updateSettings')).toEqual([
      [AGENT.id, { writeMode: 'never' }],
      [AGENT.id, { writeMode: 'allow' }],
    ]);
  });
}

test('stops a reply and says so', async () => {
  const app = launched.app;
  await open('dark', chatPath(CHATS.fresh.id));
  const composer = page.getByRole('textbox', { name: 'Message Service desk' });
  await composer.fill('Who owes us money?');
  await composer.press('Enter');
  await emitWorkspace(app, { type: 'message.updated', message: pricingReply('working') });
  await page.getByRole('button', { name: 'Stop' }).click();
  expect(await callsTo(app, 'workspace:stop')).toEqual([[CHATS.fresh.id]]);
  await emitWorkspace(app, {
    type: 'message.updated',
    message: { ...pricingReply('working'), status: 'stopped' },
  });
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('opens the chat used last when the workspace opens', async () => {
  await open('dark', '/');
  await expect(page).toHaveURL(new RegExp(`#${chatPath(CHATS.fresh.id)}$`));
  await expect(page.getByRole('navigation', { name: 'Agents' })).toContainText('Close out Tuesday');
});
