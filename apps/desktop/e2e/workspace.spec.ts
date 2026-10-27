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

    await page.getByRole('button', { name: 'Download' }).click();
    await expect.poll(() => callsTo(app, 'ollama:pull')).toEqual([[STUDENT_MODEL]]);
    await emitPullProgress(app, { model: STUDENT_MODEL, status: 'pulling manifest', done: false });
    await emitPullProgress(app, {
      model: STUDENT_MODEL,
      status: 'pulling 3f2ad1c8e7b1',
      completedBytes: 4.2 * GB,
      totalBytes: 18 * GB,
      done: false,
    });
    const progress = page.getByRole('progressbar', { name: 'Downloading Muse Glimmer' });
    await expect(progress).toHaveAttribute('aria-valuenow', '23');
    await expect(page.getByText('4.2 GB of 18 GB')).toBeVisible();
    await capture(`welcome-download-${theme}.png`);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a mentor' })).toBeVisible();
    const contributor = page.getByRole('radio', { name: /contributor tier/ });
    await expect(contributor).toContainText('Meta may train on what you send');
    await contributor.click();
    await expect(contributor).toHaveAttribute('aria-checked', 'true');
    const key = page.getByLabel('Meta API key');
    await key.fill('not-a-real-key');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connected to Spark')).toBeVisible();
    await expect(key).toHaveValue('');
    expect(await callsTo(app, 'secrets:set')).toEqual([['meta']]);
    expect(await callsTo(app, 'connections:testMentor')).toEqual([
      [expect.objectContaining({ model: 'muse-spark-1.3-contributor', secretRef: 'meta' })],
    ]);
    await capture(`welcome-mentor-${theme}.png`);

    await page.getByRole('button', { name: 'Continue' }).click();
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
      'Price a finished job',
      'Who owes us money?',
      'Book the next free slot',
    ]);
    await expect(page.getByText('Harness v4')).toBeVisible();
    await expect(page.getByText('muse-glimmer:30b Q4_K_M')).toBeVisible();
    await expect(page.getByText('Spark: off')).toBeVisible();
    await capture(`workspace-new-chat-${theme}.png`);

    await suggestions.getByRole('button', { name: 'Price a finished job' }).click();
    const composer = page.getByRole('textbox', { name: 'Message Service desk' });
    await expect(composer).toHaveValue('Price a finished job');
    const request = 'Price the two jobs Dana finished today and tell me the totals.';
    await composer.fill(request);
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    await expect(page.getByRole('article', { name: 'You' })).toHaveText(request);
    expect(await callsTo(app, 'workspace:send')).toEqual([[CHATS.fresh.id, request]]);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Thinking' })).toBeVisible();

    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('started') });
    await expect(page.getByRole('button', { name: 'read_table jobs.csv' })).toBeVisible();
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('working') });
    await expect(page.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'invoice_total job 4410' })).toBeVisible();
    await capture(`workspace-streaming-${theme}.png`);

    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('writing') });
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('done') });
    await updateChat(app, CHATS.fresh.id, { running: false });
    await expect(page.getByRole('button', { name: 'Worked for 3s' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Steps' })).toBeHidden();
    await expect(page.locator('strong', { hasText: '$486.20' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Open invoices' }).getByRole('row')).toHaveCount(
      5,
    );
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Price the two jobs Dana finished',
    );
    await capture(`workspace-chat-${theme}.png`);

    await page.getByRole('button', { name: 'Show all 6' }).click();
    const panel = page.getByRole('complementary', { name: 'Open invoices' });
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
    const invoices = page.getByRole('group', { name: 'Write to invoices.csv' });
    const booking = page.getByRole('group', { name: 'Write to bookings.csv' });

    await invoices.getByRole('button', { name: /Update invoices\.csv/ }).click();
    const preview = invoices.getByRole('table', { name: 'Rows this change writes' });
    await expect(preview.getByRole('row')).toHaveCount(3);
    await expect(preview).toContainText('Added');
    await expect(preview).toContainText('INV-1044');
    await capture(`workspace-approval-${theme}.png`);

    await invoices.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(invoices).toContainText('Allowed');
    await booking.getByRole('button', { name: 'Deny' }).click();
    await expect(booking).toContainText('Denied');
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
    expect(await callsTo(app, 'workspace:decide')).toEqual([
      ['chg_invoices', 'approve'],
      ['chg_booking', 'deny'],
    ]);
  });
}

for (const theme of THEMES) {
  test(`refuses a task type with the reason from the report card (${theme})`, async () => {
    await open(theme, chatPath(CHATS.refund.id));
    const refusal = page.getByRole('note');
    await expect(refusal).toContainText("Service desk doesn't handle refunds");
    await expect(refusal).toContainText('The office files have no refund policy');
    await capture(`workspace-refusal-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`changes what the agent may write and opens its settings (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    await page.getByRole('button', { name: 'Ask before writing' }).click();
    await expect(page.getByRole('button', { name: 'Writes allowed' })).toBeVisible();

    const settingsButton = page.getByRole('button', { name: 'Service desk settings' });
    await settingsButton.click();
    const dialog = page.getByRole('dialog', { name: 'Service desk', exact: true });
    await expect(dialog.getByText('Prices finished jobs, chases overdue balances')).toBeVisible();
    await expect(dialog.getByText('v4 · Ready')).toBeVisible();
    await capture(`workspace-agent-general-${theme}.png`);

    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete Service desk?' });
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(dialog).toBeVisible();
    expect(await callsTo(app, 'graduates:remove')).toEqual([]);

    await dialog.getByRole('tab', { name: 'Permissions' }).click();
    await expect(dialog.getByRole('radio', { name: 'Allow' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await dialog.getByRole('radio', { name: 'Never' }).click();
    await expect(dialog.getByText('Only reads your files')).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Network access' })).toBeDisabled();
    await expect(dialog.getByText('invoices.csv, bookings.csv')).toBeVisible();
    await capture(`workspace-agent-permissions-${theme}.png`);

    await dialog.getByRole('tab', { name: 'Report' }).click();
    await expect(dialog.getByText('86%')).toBeVisible();
    await expect(dialog.getByText('The office files have no refund policy')).toBeVisible();
    await capture(`workspace-agent-report-${theme}.png`);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await callsTo(app, 'graduates:updateSettings')).toEqual([
      [AGENT.id, { writeMode: 'allow' }],
      [AGENT.id, { writeMode: 'never' }],
    ]);
    await expect(page.getByRole('button', { name: 'Read only' })).toBeVisible();

    await settingsButton.click();
    await dialog.getByRole('tab', { name: 'Export' }).click();
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByText('Exported Service desk')).toBeVisible();
    expect(await callsTo(app, 'graduates:exportFolder')).toEqual([
      [AGENT.id, 'C:\\Users\\dana\\Exports'],
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
