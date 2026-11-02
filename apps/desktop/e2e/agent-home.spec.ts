import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { activitySpan, answerTimes, toolUse } from '../src/renderer/src/agent/activity';
import { formatAnswerTime } from '../src/renderer/src/flow/format';
import { ACTIVITY_PLANS, activityOf, agentHistory } from './fixtures-activity';
import { GPU_12GB, stubEngine } from './fixtures';
import { FIELD_MEASUREMENT } from './fixtures-field';
import { AGENT, callsTo, engineSeed, installFakeEngine } from './fixtures-workspace';

/*
 * An agent's home, where opening it lands: a session started from its box works while the
 * person stays, its sessions open their chats, and its figures are counted from the chats the
 * agent host keeps, the meter's records and the network guard.
 */

const SIZE = { width: 1440, height: 900 };

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

/** The service desk's work since its version was accepted, ending now. */
const history = agentHistory([activityOf(AGENT, ACTIVITY_PLANS.serviceDesk)]);
/** The days the chart covers: from the version's acceptance, a week at least. */
const span = activitySpan(AGENT.manifest.acceptedAt ?? AGENT.manifest.createdAt, new Date());
const exchanges = ACTIVITY_PLANS.serviceDesk.flatMap((session) => session.exchanges);

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
  await installFakeEngine(
    launched.app,
    engineSeed({ chats: history.chats, messages: history.messages, gpu: GPU_12GB }),
  );
  await stubEngine(launched.app, {
    'runs:runtimeMeasurements': [{ ...FIELD_MEASUREMENT, runId: AGENT.manifest.runId }],
    'reports:list': ['local'],
    'mentoring:fieldCounterexamples': [],
  });
  await updateSettings(page, { onboarded: true, edition: 'personal' });
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await launched?.close();
});

const home = () => page.getByRole('main');

test('opening the app lands on the home of the agent used last', async () => {
  await expect(page).toHaveURL(new RegExp(`#/agents/${AGENT.id}$`));
  await expect(home().getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  await settle(page);
});

test("counts the agent's requests, answer times and tools from its chats", async () => {
  const activity = home().getByRole('region', { name: 'Activity' });
  await expect(
    activity.getByText(span.fromAcceptance ? /^Requests since / : `Requests, ${span.days} days`),
  ).toBeVisible();
  await expect(activity).toContainText(String(exchanges.length));
  const times = answerTimes(history.messages);
  await expect(activity).toContainText(formatAnswerTime(times.median ?? 0));
  await expect(activity).toContainText(formatAnswerTime(times.p95 ?? 0));
  // Every bar reads out as its day and its count.
  await expect(activity.getByRole('figure', { name: 'Requests per day' })).toBeVisible();
  await expect(activity.getByRole('listitem')).toHaveCount(span.days);

  const work = home().getByRole('region', { name: 'Tools and decisions' });
  const [most] = toolUse(history.messages);
  await expect(work.getByRole('meter', { name: most?.name ?? '' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  const allowed = exchanges.filter((exchange) => exchange.write?.status === 'approved').length;
  await expect(work.getByRole('definition').first()).toHaveText(String(allowed));
});

test('says where it runs, what it took at its peak, and that it reaches only this computer', async () => {
  const here = home().getByRole('region', { name: 'On this computer' });
  await expect(here).toContainText(GPU_12GB.name);
  await expect(here).toContainText('Memory at its peak');
  await expect(here).toContainText('11 GB of 12 GB');
  await expect(here).toContainText('Reaches only 127.0.0.1:11434; no call stopped');
});

test('the sidebar shows the open agent, selected', async () => {
  const row = page
    .getByRole('navigation', { name: 'Agents' })
    .getByRole('button', { name: 'Service desk', exact: true });
  await expect(row).toHaveAttribute('aria-current', 'page');
  await expect(row).toBeInViewport();
});

test('a session opens its chat, and the sidebar brings the home back', async () => {
  const sessions = home().getByRole('region', { name: 'Sessions' });
  const newest = history.chats[0];
  if (!newest) throw new Error('No sessions.');
  await sessions.getByRole('button', { name: new RegExp(newest.title) }).click();
  await expect(page).toHaveURL(new RegExp(`#/agents/${AGENT.id}/chats/${newest.id}$`));
  await page
    .getByRole('navigation', { name: 'Agents' })
    .getByRole('button', { name: 'Service desk', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/agents/${AGENT.id}$`));
});

test('a request sent from the home starts a session that works while the person stays', async () => {
  const box = page.getByRole('textbox', { name: 'New session with Service desk' });
  await box.fill('Which invoices from October are still open?');
  await box.press('Enter');
  expect(await callsTo(launched.app, 'workspace:createChat')).toEqual([[AGENT.id]]);
  await expect.poll(() => callsTo(launched.app, 'workspace:send')).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp(`#/agents/${AGENT.id}$`));
  await expect(box).toHaveValue('');
  const sessions = home().getByRole('region', { name: 'Sessions' });
  await expect(sessions.getByRole('listitem').first()).toContainText('Which invoices from October');
  await expect(sessions.getByRole('img', { name: 'Working' }).first()).toBeVisible();
});

test('a starter request fills the box', async () => {
  const starters = home().getByRole('group', { name: 'Things to ask Service desk' });
  const first = starters.getByRole('button').first();
  const text = (await first.textContent()) ?? '';
  await first.click();
  await expect(page.getByRole('textbox', { name: 'New session with Service desk' })).toHaveValue(
    text,
  );
});

test('the palette opens an agent at its home', async () => {
  await goTo(page, `/agents/${AGENT.id}/chats/${history.chats[0]?.id ?? ''}`);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.getByRole('option', { name: 'Open Service desk' }).click();
  await expect(page).toHaveURL(new RegExp(`#/agents/${AGENT.id}$`));
});
