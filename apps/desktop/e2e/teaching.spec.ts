import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { ENGINE_RESTARTING, stubEngineFailure } from './fixtures';
import {
  finishImprovement,
  FLAGGED,
  IMPORTED_AGENT,
  IMPORTED_CHAT,
  IMPORTED_MESSAGES,
  IMPROVE_RUN_ID,
  installTeachingFake,
  TEACHING_AGENT,
  TEACHING_VERSIONS,
  type TeachingSeed,
} from './fixtures-teaching';
import { installation } from './fixtures-versions';
import {
  AGENT,
  CHATS,
  callsTo,
  emitWorkspace,
  engineSeed,
  installFakeEngine,
  MESSAGES,
  updateChat,
} from './fixtures-workspace';
import { AT } from './story';

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
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

const EMPTY: TeachingSeed = { versions: TEACHING_VERSIONS, corrections: [], shares: false };
const FILLED: TeachingSeed = { versions: TEACHING_VERSIONS, corrections: FLAGGED, shares: true };

/** The stand-in engines with Service desk and an imported agent, then the app at `path`. */
async function open(path: string, teaching: TeachingSeed): Promise<void> {
  await installFakeEngine(
    launched.app,
    engineSeed({
      graduates: [TEACHING_AGENT, IMPORTED_AGENT],
      versions: TEACHING_VERSIONS,
      installation: installation(AGENT.id),
      chats: [...Object.values(CHATS), IMPORTED_CHAT],
      messages: [...MESSAGES, ...IMPORTED_MESSAGES],
    }),
  );
  await installTeachingFake(launched.app, teaching);
  await updateSettings(page, { onboarded: true });
  // A reload keeps the route, and the last test may have ended on a run this stand-in lacks.
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

const chatPath = (graduateId: string, chatId: string) => `/agents/${graduateId}/chats/${chatId}`;

/** Flags the open chat's reply and returns the sheet it opens. */
async function flagReply(): Promise<Locator> {
  await page.getByRole('button', { name: 'Flag for teaching' }).last().click();
  const sheet = page.getByRole('dialog', { name: 'Teach this' });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function openTeaching(name = 'Service desk'): Promise<Locator> {
  await page.getByRole('button', { name: `${name} settings` }).click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await dialog.getByRole('tab', { name: 'Teaching' }).click();
  return dialog;
}

const WRONG = 'INV-3018 was paid on Oct 2, so Okafor owes nothing.';
const WANTED = 'Only invoices still unpaid after their due date.';

test('flags an answer, sends nothing until agreed, and queues, applies or discards its lesson', async () => {
  const app = launched.app;
  await open(chatPath(AGENT.id, CHATS.closeout.id), EMPTY);

  // Each settled reply has a flag beside Copy, named for what it does.
  await page.getByRole('button', { name: 'Flag for teaching' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Flag for teaching');
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, 'teach-reply-actions-dark.png'),
    animations: 'disabled',
    timeout: 15_000,
  });

  const sheet = await flagReply();
  await expect(sheet).toContainText('Reply to "Who still owes us money from September?"');
  await expect(sheet).toContainText('Three customers, $2,915.00 in total.');
  await expect(
    sheet.getByText('Only this exchange, its steps and your notes go to Spark, for up to $0.25.'),
  ).toBeVisible();
  const send = sheet.getByRole('button', { name: 'Share with Spark' });
  await expect(send).toBeDisabled();
  await capture('teach-sheet-dark.png');

  await sheet.getByLabel('What was wrong').fill(WRONG);
  await sheet.getByLabel('What it should have done').fill(WANTED);
  const files = sheet.getByRole('group', { name: 'Files it should have used' });
  await files.getByRole('button', { name: 'invoices.csv' }).click();
  await expect(files.getByRole('button', { name: 'invoices.csv' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await capture('teach-sheet-filled-dark.png');
  // Nothing has left this computer: no permission asked of the job, no exchange sent.
  expect(await callsTo(app, 'teach:shareCorrections')).toEqual([]);
  expect(await callsTo(app, 'teach:propose')).toEqual([]);

  await send.click();
  await expect(sheet.getByText('Rule', { exact: true })).toBeVisible();
  await expect(sheet).toContainText(
    'Count an invoice as overdue only when it is unpaid and past its due date.',
  );
  await expect(sheet).toContainText('Adds to its instructions');
  await expect(sheet).toContainText('No, a rule is enough');
  await expect(sheet).toContainText(WRONG);
  expect(await callsTo(app, 'teach:shareCorrections')).toEqual([[AGENT.id, true]]);
  expect(await callsTo(app, 'teach:propose')).toEqual([
    [
      CHATS.closeout.id,
      'msg_close_2',
      {
        wrong: WRONG,
        wanted: WANTED,
        evidence: 'Files it should have used: data/invoices.csv',
        consent: true,
      },
    ],
  ]);
  await capture('teach-proposal-dark.png');

  // An instruction applies at once as version 3; version 2 keeps answering.
  await sheet.getByRole('button', { name: 'Save as version 3' }).click();
  await expect(sheet.getByText('Saved as version 3')).toBeVisible();
  await expect(sheet).toContainText('Version 2 keeps answering until you use version 3.');
  await capture('teach-applied-dark.png');
  expect(await callsTo(app, 'teach:apply')).toEqual([['cor_new1']]);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();

  // A weakness is saved for Improve.
  const second = await flagReply();
  await second
    .getByLabel('What was wrong')
    .fill('It added the Brennan payment to the wrong invoice.');
  await second.getByRole('button', { name: 'Share with Spark' }).click();
  await expect(second.getByText('Needs practice', { exact: true })).toBeVisible();
  await expect(second).toContainText('Yes, Improve will practice it');
  await expect(second.getByRole('button', { name: /Save as/ })).toHaveCount(0);
  await capture('teach-proposal-weakness-dark.png');
  await second.getByRole('button', { name: 'Save for Improve' }).click();
  await expect(second.getByText('Saved for Improve')).toBeVisible();
  await expect(second).toContainText('1 lesson saved. Improve teaches it when you run it.');
  await capture('teach-queued-dark.png');
  expect(await callsTo(app, 'teach:queue')).toEqual([['cor_new2']]);
  // The job already shares flagged answers, so it isn't asked again.
  expect(await callsTo(app, 'teach:shareCorrections')).toHaveLength(1);

  // One the mentor can't check against the exchange is discarded.
  await second.getByRole('button', { name: 'Open Teaching' }).click();
  const teaching = page.getByRole('dialog', { name: 'Service desk', exact: true });
  await expect(teaching.getByRole('tab', { name: 'Teaching' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const versions = teaching.getByRole('list', { name: 'Versions' });
  await expect(versions.getByRole('listitem', { name: 'Version 3' })).toContainText(
    'New, not in use yet',
  );
  await expect(versions.getByRole('listitem', { name: 'Version 3' })).toContainText(
    'No final test yet',
  );
  await expect(versions.getByRole('listitem', { name: 'Version 2' })).toContainText('In use');
  await page.keyboard.press('Escape');
  const third = await flagReply();
  await third.getByLabel('What was wrong').fill('The total is wrong.');
  await third.getByRole('button', { name: 'Share with Spark' }).click();
  await expect(third.getByText("Can't be checked", { exact: true })).toBeVisible();
  await expect(third.getByRole('button', { name: 'Save for Improve' })).toHaveCount(0);
  await third.getByRole('button', { name: 'Discard' }).click();
  await expect(third).toBeHidden();
  expect(await callsTo(app, 'teach:discard')).toEqual([['cor_new3']]);
});

test("says why a lesson couldn't be proposed, keeps what was written, and refuses an exchange from the final test", async () => {
  await open(chatPath(AGENT.id, CHATS.closeout.id), FILLED);
  // The guard that refused it crosses with its code, which the sheet words for the person.
  await stubEngineFailure(launched.app, {
    'teach:propose': {
      message:
        'Reading this exchange could cost up to $0.31, more than the $0.25 a correction may. Shorten what you wrote, or correct a shorter reply.',
      code: 'guard_budget',
    },
  });
  const sheet = await flagReply();
  await sheet.getByLabel('What was wrong').fill(WRONG);
  await sheet.getByRole('button', { name: 'Share with Spark' }).click();
  await expect(sheet.getByText('Too long to review')).toBeVisible();
  await expect(sheet).toContainText(
    'Reading it would cost more than the $0.25 limit. Shorten your note, or flag a shorter answer.',
  );
  // What was written stays, to say again more briefly.
  await expect(sheet.getByLabel('What was wrong')).toHaveValue(WRONG);
  await expect(sheet.getByRole('button', { name: 'Share with Spark' })).toBeEnabled();
  await capture('teach-error-dark.png');

  await stubEngineFailure(launched.app, {
    'teach:propose': {
      message:
        "Refused a mentor call: its payload matched 1 locked test task, in the person's request.",
      code: 'guard_split',
    },
  });
  await sheet.getByRole('button', { name: 'Share with Spark' }).click();
  // The leak check's refusal, in the app's words: it calls the locked test the final test.
  await expect(sheet.getByText('Not shared', { exact: true })).toBeVisible();
  await expect(sheet).toContainText(
    'It matches a question from the final test, which Spark must never see. Flag a different answer.',
  );
  // The same exchange would be refused again, so it isn't offered again.
  await expect(sheet.getByRole('button', { name: 'Share with Spark' })).toHaveCount(0);
  await capture('teach-refused-dark.png');
});

test('shows what is being taught above the versions, and the flagged answers to review', async () => {
  await open(chatPath(AGENT.id, CHATS.closeout.id), FILLED);
  const dialog = await openTeaching();
  const lessons = dialog.getByRole('region', { name: 'Lessons' });
  await expect(lessons).toContainText('Flagged answers');
  await expect(lessons).toContainText('3 flagged answers · 1 to review');
  await expect(lessons).toContainText('Teach it something new');
  await expect(lessons).toContainText('2 lessons saved · up to $5 and 4 hours');
  await expect(dialog.getByRole('list', { name: 'Versions' }).getByRole('listitem')).toHaveCount(2);
  await capture('agent-teaching-lessons-dark.png');

  await lessons.getByRole('button', { name: 'Review' }).click();
  const review = page.getByRole('dialog', { name: 'Flagged answers' });
  const list = review.getByRole('list', { name: 'Flagged answers' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('listitem').first()).toContainText('To review');
  await capture('teach-review-dark.png');

  await list.getByRole('button', { name: /Ask which day before booking/ }).click();
  const lesson = page.getByRole('dialog', { name: 'Flagged answer' });
  await expect(lesson).toContainText('Adds to its instructions');
  await expect(lesson.getByRole('button', { name: 'Save as version 3' })).toBeVisible();
  await capture('teach-review-lesson-dark.png');
  await lesson.getByRole('button', { name: 'Save for Improve' }).click();
  await expect(page.getByRole('dialog', { name: 'Flagged answers' })).toBeVisible();
  await expect(list.getByRole('listitem').first()).toContainText('Saved for Improve');
  expect(await callsTo(launched.app, 'teach:queue')).toEqual([['cor_booking']]);
  await page.keyboard.press('Escape');
  await expect(lessons).toContainText('3 flagged answers');

  // Teaching it something new starts a chat to show it.
  await lessons.getByRole('button', { name: 'New chat' }).click();
  await expect(page).toHaveURL(/#\/agents\/grd_servicedesk\/chats\/cht_teach_1$/);
  await expect(dialog).toBeHidden();
});

test("shows a Teaching tab with nothing flagged yet, and one that couldn't load", async () => {
  await open(chatPath(AGENT.id, CHATS.closeout.id), EMPTY);
  const dialog = await openTeaching();
  const lessons = dialog.getByRole('region', { name: 'Lessons' });
  await expect(lessons).toContainText('None yet');
  await expect(lessons).toContainText('Flag an answer to teach it first');
  await expect(lessons.getByRole('button', { name: 'Review' })).toHaveCount(0);
  await expect(lessons.getByRole('button', { name: 'Improve' })).toHaveCount(0);
  await capture('agent-teaching-empty-dark.png');
  await page.keyboard.press('Escape');

  await stubEngineFailure(launched.app, { 'teach:overview': ENGINE_RESTARTING });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, chatPath(AGENT.id, CHATS.closeout.id));
  const failed = await openTeaching();
  await expect(failed.getByText("Couldn't load its lessons")).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Try again' }).first()).toBeVisible();
  await capture('agent-teaching-lessons-error-dark.png');
});

test("says why an agent from another computer can't be taught here", async () => {
  await open(chatPath(IMPORTED_AGENT.id, IMPORTED_CHAT.id), FILLED);
  const sheet = await flagReply();
  await expect(sheet.getByText("Returns desk can't be taught here")).toBeVisible();
  await expect(sheet).toContainText(
    'Returns desk was made on another computer. It can be taught there, where its practice and check tasks are.',
  );
  await expect(sheet.getByRole('button', { name: /Share/ })).toHaveCount(0);
  await capture('teach-imported-dark.png');
  await sheet.getByRole('button', { name: 'Close' }).last().click();
  await expect(sheet).toBeHidden();

  const dialog = await openTeaching('Returns desk');
  const lessons = dialog.getByRole('region', { name: 'Lessons' });
  await expect(lessons).toContainText("Can't be taught on this computer");
  await expect(lessons.getByRole('button')).toHaveCount(0);
  await capture('agent-teaching-imported-dark.png');
  expect(await callsTo(launched.app, 'teach:propose')).toEqual([]);
});

test('improves the agent into a new version while the active one keeps answering, and stops', async () => {
  const app = launched.app;
  await open(chatPath(AGENT.id, CHATS.closeout.id), FILLED);
  const dialog = await openTeaching();
  await dialog
    .getByRole('region', { name: 'Lessons' })
    .getByRole('button', { name: 'Improve' })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Improve Service desk?' });
  await expect(confirm).toContainText('Version 2 keeps answering meanwhile.');
  await expect(confirm).toContainText(
    'Stops at $5 of Spark, 4 hours or 10 rounds, whichever comes first.',
  );
  await capture('improve-dialog-dark.png');
  await confirm.getByRole('button', { name: 'Start improving' }).click();
  expect(await callsTo(app, 'teach:improve')).toEqual([
    [AGENT.id, { maxRounds: 10, maxMentorUsd: 5 }],
  ]);

  // The training view, with what the queue taught at the top.
  await expect(page).toHaveURL(new RegExp(`#/runs/${IMPROVE_RUN_ID}/train$`));
  const taught = page.getByRole('region', { name: 'Lessons from your flagged answers' });
  await expect(taught).toContainText(
    'Match each payment to its invoice by invoice number before adding up what is owed.',
  );
  await expect(taught).toContainText('Improving from version 2');
  await capture('improve-train-dark.png');
  // The evidence views work in an improvement as in any run: a round's drawer from the rounds
  // list, and no worked examples section until it has an example to list.
  await expect(page.getByRole('region', { name: 'Worked examples' })).toHaveCount(0);
  await page
    .getByRole('region', { name: 'Rounds' })
    .getByRole('button')
    .filter({ hasText: /^01/ })
    .click();
  const roundDrawer = page.getByRole('dialog', { name: /^Round 1/ });
  await expect(roundDrawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(roundDrawer).toBeHidden();

  // Meanwhile the active version answers in the workspace, and the sidebar shows it improving.
  await goTo(page, chatPath(AGENT.id, CHATS.closeout.id));
  await expect(
    page
      .getByRole('navigation', { name: 'Agents' })
      .getByRole('button', { name: /^Training Service desk/ }),
  ).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message Service desk' });
  await composer.fill('And from October?');
  await composer.press('Enter');
  await emitWorkspace(app, {
    type: 'message.updated',
    message: {
      id: 'msg_october',
      chatId: CHATS.closeout.id,
      role: 'agent',
      createdAt: AT,
      text: 'Two customers, $1,180.00 in total.',
      steps: [
        {
          id: 's1',
          kind: 'tool',
          name: 'read',
          detail: 'data/invoices.csv',
          meta: '5 rows',
          status: 'done',
        },
      ],
      blocks: [],
      status: 'done',
      workedMs: 41_000,
      graduateVersion: 2,
    },
  });
  await updateChat(app, CHATS.closeout.id, { running: false });
  await page.getByRole('button', { name: 'Worked for 41 s' }).click();
  await expect(page.getByRole('list', { name: 'Steps' })).toContainText('Answered by version 2');

  // Stop works at any point, and says what comes of it.
  await goTo(page, `/runs/${IMPROVE_RUN_ID}/train`);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const stop = page.getByRole('dialog', { name: 'Stop improving?' });
  await expect(stop).toContainText(
    "It hasn't found a change that helps yet, so it makes no version",
  );
  await capture('improve-stop-dark.png');
  await stop.getByRole('button', { name: 'Stop improving' }).click();
  await expect(page.getByText('Improving stopped')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to Teaching' })).toBeVisible();
  expect(await callsTo(app, 'runs:stop')).toEqual([[IMPROVE_RUN_ID]]);

  // Back in Teaching, the lessons are in the queue again, and a second try makes version 3.
  await page.getByRole('button', { name: 'Back to Teaching' }).click();
  const again = page.getByRole('dialog', { name: 'Service desk', exact: true });
  const lessons = again.getByRole('region', { name: 'Lessons' });
  await expect(lessons).toContainText('2 lessons saved · up to $5 and 4 hours');
  await lessons.getByRole('button', { name: 'Improve' }).click();
  await page
    .getByRole('dialog', { name: 'Improve Service desk?' })
    .getByRole('button', { name: 'Start improving' })
    .click();
  await expect(page).toHaveURL(/#\/runs\/run_improve_2\/train$/);
  await goTo(page, chatPath(AGENT.id, CHATS.closeout.id));
  const running = await openTeaching();
  await expect(running.getByRole('region', { name: 'Lessons' })).toContainText(
    'Improving from version 2',
  );
  await expect(
    running.getByRole('region', { name: 'Lessons' }).getByRole('button', { name: 'Stop' }),
  ).toBeVisible();
  await capture('agent-teaching-improving-dark.png');

  await finishImprovement(app);
  const made = running.getByRole('region', { name: 'Lessons' });
  await expect(made).toContainText('Made version 3 · 93% → 98% on check tasks');
  const versions = running.getByRole('list', { name: 'Versions' });
  await expect(versions.getByRole('listitem', { name: 'Version 3' })).toContainText(
    'New, not in use yet',
  );
  await expect(versions.getByRole('listitem', { name: 'Version 2' })).toContainText('In use');
  await capture('agent-teaching-made-dark.png');

  await made.getByRole('button', { name: 'See what changed' }).click();
  await expect(page).toHaveURL(/#\/runs\/run_improve_2\/improvement$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Service desk, version 3' }),
  ).toBeVisible();
  await expect(page.getByText("It hasn't taken a final test.", { exact: false })).toBeVisible();
  await expect(page.getByText('You can use version 3')).toBeVisible();
  // What it spent, each against its cap.
  await expect(page.getByText('of $5', { exact: true })).toBeVisible();
  await expect(page.getByText('of 4 h', { exact: true })).toBeVisible();
  await expect(page.getByText('of 10', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What improved' })).toContainText(
    'Overdue balances',
  );
  await expect(page.getByRole('region', { name: 'Unchanged' })).toContainText('Invoices');
  await capture('improve-report-dark.png');

  await page.getByRole('button', { name: 'Use version 3' }).click();
  const promote = page.getByRole('dialog', { name: 'Use version 3?' });
  await expect(promote).toContainText("Version 3 hasn't taken a final test.");
  await promote.getByRole('button', { name: 'Use version 3' }).click();
  await expect(page.getByText('No new version to use')).toBeVisible();
  await expect(page.getByText('Version 3 is already active.')).toBeVisible();
  expect(await callsTo(app, 'graduates:promote')).toEqual([[AGENT.id, 3]]);
});
