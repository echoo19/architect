import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { goTo, infoTipText, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngineFailure } from './fixtures';
import {
  installTeamsFake,
  TEAM,
  TEAM_AGENTS,
  TEAM_CHAT,
  teamCallsTo,
  teamWorld,
} from './fixtures-teams';

/*
 * A team on the stand-in engine (decision 100), from the examples' demo at Fenwick: made in
 * Models, listed in the sidebar, and a chat where Inventory desk asks Assay desk which compounds
 * need a re-test before it reserves their stock. Each agent's work and lesson are its own; in a
 * consult the teammate can't write (decision 107), so every write is the lead's to propose.
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
  await installTeamsFake(launched.app, teamWorld());
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

async function openAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

/** Scrolls the chat, and only the chat, so the element sits in the middle of it. */
async function centerInChat(element: Locator): Promise<void> {
  await element.evaluate((target) => {
    let box = target.parentElement;
    while (box && getComputedStyle(box).overflowY !== 'auto') box = box.parentElement;
    if (!box) return;
    const at = target.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    box.scrollTop += at.top - frame.top - (frame.height - at.height) / 2;
  });
}

const { lead, teammate } = TEAM_AGENTS;
const sidebar = () => page.getByRole('navigation', { name: 'Agents' });
const reply = () => page.getByRole('article', { name: lead.name });

test('a team is made in Models, from a lead and a teammate', async () => {
  await openAt('/models/teams');
  await expect(page.getByRole('tab', { name: 'Teams' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'No teams yet' })).toBeVisible();
  await expect(sidebar().getByRole('group', { name: 'Teams' })).toHaveCount(0);

  await page.getByRole('button', { name: 'New team' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New team' });
  // Blank, the held button says why, as it does for anything else that holds the team back.
  await expect(dialog.getByRole('status')).toHaveText('Name the team');
  await expect(dialog.getByRole('button', { name: 'Make team' })).toHaveAccessibleDescription(
    'Name the team',
  );
  await dialog.getByLabel('Name').fill(TEAM.name);
  await dialog.getByRole('combobox', { name: 'Lead' }).click();
  await page.getByRole('option', { name: lead.name }).click();
  // Named and led, it says what it still needs, and Save says so too.
  const make = dialog.getByRole('button', { name: 'Make team' });
  await expect(dialog.getByRole('status')).toHaveText('Choose a teammate');
  await expect(make).toBeDisabled();
  await expect(make).toHaveAccessibleDescription('Choose a teammate');
  await dialog.getByRole('checkbox', { name: teammate.name }).click();
  const role = dialog.getByRole('textbox', { name: `What ${lead.name} asks ${teammate.name} for` });
  await expect(role).toHaveValue("Reads a screening lab's plate exports by the lab's own rules.");
  await capture('team-new-dark.png');

  // The engine's refusal shows in the dialog, beside what can be changed.
  const refusal = `${teammate.name} has a helper called ask_teammate, the name of the tool a team's lead asks its teammates with, so it can't join a team.`;
  await stubEngineFailure(launched.app, { 'teams:create': refusal });
  await dialog.getByRole('button', { name: 'Make team' }).click();
  await expect(dialog).toContainText("Couldn't make the team");
  await expect(dialog).toContainText(refusal);
  await installTeamsFake(launched.app, teamWorld());

  await dialog.getByRole('button', { name: 'Make team' }).click();
  await expect(dialog).toHaveCount(0);
  // Closed, it gives focus back to the button that opened it.
  await expect(page.getByRole('button', { name: 'New team' }).first()).toBeFocused();
  // A role left at the contract's summary isn't saved, so the teammate keeps following it.
  expect(await teamCallsTo(launched.app, 'teams:create')).toEqual([
    [{ name: TEAM.name, members: [{ graduateId: lead.id }, { graduateId: teammate.id }] }],
  ]);
  const row = page.getByRole('table', { name: 'Teams' }).getByRole('row', { name: /Screening/ });
  await expect(row).toContainText(lead.name);
  await expect(row).toContainText(teammate.name);
  await expect(row.getByRole('cell').last()).toHaveText('1');
  await expect(sidebar().getByRole('group', { name: 'Teams' })).toContainText(TEAM.name);
  await capture('models-teams-dark.png');

  // The Lab names the team's chat that waits for an approval.
  await goTo(page, '/');
  await expect(
    page
      .getByRole('region', { name: 'Needs you' })
      .getByRole('button', { name: new RegExp(`${TEAM_CHAT.title}.*${TEAM.name}.*Approve$`) }),
  ).toBeVisible();
});

test('in the team’s chat the lead asks its teammate, whose own work opens under it', async () => {
  await sidebar().getByRole('button', { name: TEAM_CHAT.title }).click();
  await expect(page).toHaveURL(new RegExp(`#/teams/${TEAM.id}/chats/${TEAM_CHAT.id}$`));
  const header = page.locator('header').first();
  // Both work at Fenwick, so the header names it once, and its menu moves each on its own.
  const shared = header.getByRole('button', {
    name: `Organization of ${lead.name} and ${teammate.name}: Fenwick Screening Core`,
  });
  await expect(shared).toBeVisible();
  await expect(header.getByRole('button', { name: /'s organization:/ })).toHaveCount(0);
  await shared.click();
  const menu = page.getByRole('menu');
  for (const agent of [lead, teammate]) await expect(menu).toContainText(agent.name);
  await expect(menu.getByRole('menuitem', { name: 'Fenwick Screening Core' })).toHaveCount(2);
  await page.keyboard.press('Escape');
  // Each agent asks before writing as its own setting says, so the team's composer has none.
  await expect(page.getByRole('button', { name: /^Saving files/ })).toHaveCount(0);
  // The header's icon says what the team is, in place.
  await header.getByRole('button', { name: `About ${TEAM.name}` }).click();
  const about = page.getByRole('dialog', { name: TEAM.name });
  await expect(about).toContainText('A teammate sees only what it is asked, never this chat');
  await expect(about).toContainText(`${teammate.name}, version 1`);
  await page.keyboard.press('Escape');
  await expect(about).toHaveCount(0);

  // The reply names who answered and whom it asked before its steps are opened, and the ask
  // itself, with the first line of the answer, shows while the lead's own steps are folded.
  await expect(reply()).toContainText(`${lead.name} asked ${teammate.name}`);
  const consult = reply().getByRole('button', { name: new RegExp(`^Asked ${teammate.name}`) });
  await expect(consult).toContainText('FW-0418 passes QC (Z′ 0.7689)');
  // The reply waits on an approval, so nothing runs: the composer says what it waits for.
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: `Message ${TEAM.name}` })).toHaveAttribute(
    'placeholder',
    'Allow or deny the change above',
  );

  await reply()
    .getByRole('button', { name: /so far/ })
    .click();
  await expect(reply().getByRole('list', { name: 'Steps' })).toBeVisible();
  // The reply names the version that answered, and that no certificate covers the team.
  expect(await infoTipText(page, reply(), 'version 1')).toBe('Not certified as a team');
  await consult.click();
  // Open, the whole answer shows below, so its first line no longer sits beside the name.
  await expect(consult).not.toContainText('FW-0418 passes QC');
  const work = reply().getByRole('list', { name: `${teammate.name}'s steps` });
  await expect(work).toContainText(/Searched\s*data\/plates\.csv for \/FW-0418\//);
  await expect(work).not.toContainText('Added to');
  await expect(work).toContainText('Answered by version 1');
  await capture('team-chat-dark.png');
});

test('the lead asks for every write, the re-tests its teammate named among them', async () => {
  await expect(reply().getByRole('group', { name: new RegExp(`^${teammate.name}:`) })).toHaveCount(
    0,
  );
  const retests = reply().getByRole('group', { name: `${lead.name}: write to data/retests.csv` });
  const holds = reply().getByRole('group', {
    name: `${lead.name}: write to data/reservations.csv`,
  });
  await expect(retests).toContainText('2 new rows');
  await expect(holds).toContainText('HOLD-0163');
  await expect(holds).toContainText('FL-04159');
  await centerInChat(retests);
  await capture('team-approval-dark.png');
  await retests.getByRole('button', { name: 'Allow once' }).click();
  await expect(retests).toContainText('Allowed');
  await expect(holds.getByRole('button', { name: 'Allow once' })).toBeVisible();
  await holds.getByRole('button', { name: 'Allow once' }).click();
  await expect(holds).toContainText('Allowed');
  expect(await teamCallsTo(launched.app, 'workspace:decide')).toEqual([
    ['chg_retests', 'approve'],
    ['chg_holds', 'approve'],
  ]);
  await expect(reply()).toContainText('FWC-13399');
  await expect(reply()).toContainText('LOW-VOLUME');
});

test("Teach this on the teammate's answer goes to the teammate", async () => {
  const flag = reply().getByRole('button', { name: `Flag ${teammate.name}'s answer for teaching` });
  await centerInChat(reply().getByRole('list', { name: `${teammate.name}'s steps` }));
  await capture('team-consultation-dark.png');
  await flag.click();
  // A teammate's answer is taught to that teammate, and the sheet's title names it.
  const sheet = page.getByRole('dialog', { name: `Teach ${teammate.name}` });
  await sheet
    .getByLabel('What was wrong')
    .fill("It didn't say which re-test id is which compound.");
  await sheet.getByRole('button', { name: /^Share with/ }).click();
  await expect(sheet).toContainText(
    'Name each compound to re-test with the re-test id it should be queued as.',
  );
  const [proposal] = await teamCallsTo(launched.app, 'teach:propose');
  expect(proposal?.[2]).toMatchObject({ step: 'step-2', consent: true });
  // Both agents whose work the exchange holds let it be shared.
  expect(await teamCallsTo(launched.app, 'teach:shareCorrections')).toEqual([
    [teammate.id, true],
    [lead.id, true],
  ]);
  await capture('team-teach-dark.png');
  await page.keyboard.press('Escape');
});

test("a team's address shows only that team's chats", async () => {
  await openAt(`/teams/${TEAM.id}/chats/cht_someone_else`);
  await expect(
    page.getByRole('heading', { name: `This chat isn't in ${TEAM.name}.` }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: `Message ${TEAM.name}` })).toHaveCount(0);
});

test('an agent in a team stays until it is taken out, and the way out opens Teams', async () => {
  await sidebar()
    .getByRole('button', { name: `${teammate.name} settings` })
    .click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('dialog', { name: `Delete ${teammate.name}?` })
    .getByRole('button', { name: 'Delete agent' })
    .click();
  const refused = page.getByRole('dialog', { name: `${teammate.name} is in a team` });
  await expect(refused).toContainText(
    `${teammate.name} is in ${TEAM.name}. Take it out of the team in Models, Teams, first.`,
  );
  await refused.getByRole('button', { name: 'Open Teams' }).click();
  await expect(page).toHaveURL(/#\/models\/teams$/);
  await expect(page.getByRole('table', { name: 'Teams' })).toBeVisible();
});

test('the personal edition has no teams', async () => {
  await updateSettings(page, { edition: 'personal' });
  const before = (await teamCallsTo(launched.app, 'teams:list')).length;
  await openAt(`/agents/${lead.id}/chats/none`);
  await expect(sidebar().getByText(lead.name)).toBeVisible();
  await expect(sidebar().getByRole('group', { name: 'Teams' })).toHaveCount(0);
  expect((await teamCallsTo(launched.app, 'teams:list')).length).toBe(before);
  await goTo(page, `/teams/${TEAM.id}/chats/${TEAM_CHAT.id}`);
  // Home, which opens the home of the agent used last.
  await expect(page).toHaveURL(/#\/agents\/[^/]+$/);

  // Started at a team's chat, it goes home before anything asks for teams or their chats.
  const asked = async () =>
    (await teamCallsTo(launched.app, 'teams:list')).length +
    (await teamCallsTo(launched.app, 'workspace:listTeamChats')).length;
  const earlier = await asked();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `/teams/${TEAM.id}/chats/${TEAM_CHAT.id}`);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page).toHaveURL(/#\/agents\/[^/]+$/);
  await settle(page);
  expect(await asked()).toBe(earlier);
});
