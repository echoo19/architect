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
    const progress = page.getByRole('progressbar', { name: 'Downloading Glimmer' });
    await expect(progress).toHaveAttribute('aria-valuenow', '23');
    await expect(page.getByText('4.2 GB of 18 GB')).toBeVisible();
    await capture(`welcome-download-${theme}.png`);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a mentor' })).toBeVisible();
    const contributor = page.getByRole('radio', { name: /contributor tier/ });
    const standard = page.getByRole('radio', { name: /Meta doesn't train on what you send/ });
    await expect(contributor).toContainText('Meta may train on what you send');
    await contributor.click();
    await expect(contributor).toHaveAttribute('aria-checked', 'true');
    await standard.click();
    await expect(standard).toHaveAttribute('aria-checked', 'true');
    await expect(contributor).toHaveAttribute('aria-checked', 'false');
    await expect(standard).toContainText('About $0.70 to train an agent');
    await expect(page.getByText('https://dev.meta.ai')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
    await capture(`welcome-mentor-${theme}.png`);
    const key = page.getByLabel('Meta API key');
    await key.fill('not-a-real-key');
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText('Connected to Spark')).toBeVisible();
    await expect(key).toHaveValue('');
    expect(await callsTo(app, 'secrets:set')).toEqual([['meta']]);
    expect(await callsTo(app, 'connections:testMentor')).toEqual([
      [expect.objectContaining({ model: 'muse-spark-1.3', secretRef: 'meta' })],
    ]);

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
      'Price a finished job and add its invoice',
      'Find who owes money after partial payments',
      'Book the earliest technician who can do the job',
    ]);
    await expect(page.getByText('Version 7 of its instructions')).toBeVisible();
    await expect(page.getByText('Glimmer, 4-bit, on this computer')).toBeVisible();
    await expect(page.getByText('Spark, the mentor: off')).toBeVisible();
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

    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('started') });
    await expect(page.getByRole('button', { name: /Reading jobs\.csv/ })).toBeVisible();
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('working') });
    // Tool steps start folded, as the setting says, and open on a click.
    const current = page.getByRole('button', { name: /Running invoice_total job J-4471/ });
    await expect(current).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('list', { name: 'Steps' })).toBeHidden();
    await current.click();
    await expect(page.getByRole('list', { name: 'Steps' }).getByRole('listitem')).toHaveCount(3);
    await capture(`workspace-streaming-${theme}.png`);

    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('writing') });
    await emitWorkspace(app, { type: 'message.updated', message: pricingReply('done') });
    await updateChat(app, CHATS.fresh.id, { running: false });
    // The steps stay as the reader left them; one more click folds them.
    const worked = page.getByRole('button', { name: 'Worked for 2m 21s' });
    await expect(worked).toHaveAttribute('aria-expanded', 'true');
    await worked.click();
    await expect(page.getByRole('list', { name: 'Steps' })).toBeHidden();
    await expect(page.locator('strong', { hasText: '$524.03' })).toBeVisible();
    const breakdown = page.getByRole('table', { name: 'Price breakdown' });
    await expect(breakdown.getByRole('row')).toHaveCount(6);
    await expect(breakdown).toContainText('2 more rows in the total: Plan discount, Tax');
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
    const invoices = page.getByRole('group', { name: 'Write to invoices.csv' });
    const booking = page.getByRole('group', { name: 'Write to bookings.csv' });

    // The rows show before anything can be allowed, and the reply waits for an answer.
    const preview = invoices.getByRole('table', { name: 'Rows this change writes' });
    await expect(preview.getByRole('row')).toHaveCount(3);
    await expect(preview).toContainText('Added');
    await expect(preview).toContainText('INV-4473');
    await expect(booking.getByRole('table', { name: 'Rows this change writes' })).toBeVisible();
    await expect(invoices).toContainText(
      'Allow once saves these rows. Always allow saves them and stops asking from now on',
    );
    await expect(booking).not.toContainText('Allow once saves');
    const waiting = page
      .getByRole('status')
      .filter({ hasText: 'Waiting for you to allow or deny the changes above.' });
    await expect(waiting).toBeVisible();
    await capture(`workspace-approval-${theme}.png`);

    await invoices.getByRole('button', { name: 'Allow once' }).click();
    await expect(invoices).toContainText('Allowed');
    await booking.getByRole('button', { name: 'Deny' }).click();
    await expect(booking).toContainText('Denied');
    await expect(page.getByRole('button', { name: 'Allow once' })).toHaveCount(0);
    await expect(waiting).toBeHidden();
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
    await expect(refusal).toContainText('The office files have no refund policy to follow');
    await expect(refusal).toContainText(
      "You'll need to handle this one yourself. Service desk can help with invoices, overdue " +
        'balances or scheduling.',
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
    await expect(dialog.getByText(/Passed its final test on /)).toBeVisible();
    await capture(`workspace-agent-general-${theme}.png`);

    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete Service desk?' });
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
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
    await capture(`workspace-agent-permissions-${theme}.png`);
    await dialog.getByRole('radio', { name: 'Never' }).click();
    await expect(dialog.getByText("Can't change your files")).toBeVisible();

    await dialog.getByRole('tab', { name: 'Report' }).click();
    await expect(dialog.getByText('92%')).toBeVisible();
    await expect(
      dialog.getByText('The office files have no refund policy to follow'),
    ).toBeVisible();
    await capture(`workspace-agent-report-${theme}.png`);

    await dialog.getByRole('tab', { name: 'Export' }).click();
    await dialog.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByText('Exported Service desk')).toBeVisible();
    expect(await callsTo(app, 'graduates:exportFolder')).toEqual([
      [AGENT.id, 'C:\\Users\\dana\\Exports'],
    ]);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Saving: Never' }).click();
    const modes = page.getByRole('menu');
    await expect(modes.getByRole('menuitem')).toHaveCount(3);
    await expect(modes).toContainText('Shows each change and waits for your OK');
    await modes.getByRole('menuitem', { name: /Allow/ }).click();
    await expect(page.getByRole('button', { name: 'Saving: Allow' })).toBeVisible();
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
