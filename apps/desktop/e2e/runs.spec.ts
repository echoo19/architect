import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import {
  emitRunEvents,
  finished,
  FLOW,
  recordedCalls,
  stubByKey,
  stubRecorded,
} from './fixtures-flow';
import {
  ANSWER,
  answerTakenUp,
  askingEngine,
  endedAskingEngine,
  flipSwitch,
  HOME_ENGINE,
  KEY_MISSING,
  LOCAL_JOB,
  NOTHING_LOCAL,
  OLLAMA_READY,
  pausedEngine,
  QUESTION,
  SIDEBAR_JOBS,
  SIDEBAR_JOBS_AFTER_ACCEPTING,
  stubSwitch,
} from './fixtures-runs';
import { graduate, reports, STORY } from './story';

/*
 * Getting back to a run and seeing what happened: the rows the sidebar keeps for a run that ended
 * or waits while the person is elsewhere, an agent that appears the moment its run ends, a run
 * paused on something that needs putting right, and a question Spark asks in the middle of
 * training. The engine is a stand-in here; `runs-engine.spec.ts` runs the same on the real one.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const WIDTH = 1440;
const TRAIN_HEIGHT = 1270;
const THEMES = ['dark', 'light'] as const;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
  await resize(900);
  await mkdir(OUT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await launched?.close();
});

async function resize(height: number): Promise<void> {
  const visible = await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) throw new Error('No window');
      main.setContentSize(size.width, size.height);
      return main.isVisible();
    },
    { width: WIDTH, height },
  );
  expect(visible).toBe(false);
  await launched.page.waitForFunction((h) => window.innerHeight === h, height);
}

async function capture(page: Page, name: string): Promise<void> {
  // The pointer would otherwise leave a hover highlight wherever the last click was.
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, `${name}.png`),
    animations: 'disabled',
    timeout: 15_000,
  });
}

async function applySettings(page: Page, patch: Parameters<typeof updateSettings>[1]) {
  await updateSettings(page, patch);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

const agents = (page: Page) => page.getByRole('navigation', { name: 'Agents' });

for (const theme of THEMES) {
  test(`lists the runs a person can open beside their agents (${theme})`, async () => {
    const { app, page } = launched;
    await stubEngine(app, HOME_ENGINE);
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await resize(900);
    await goTo(page, '/');
    const nav = agents(page);

    // One row for each job's newest run of its agent, with what it asks of the person.
    await expect(nav.getByRole('button', { name: /^Training Service desk/ })).toContainText(
      'Training',
    );
    await expect(nav.getByRole('button', { name: /Returns desk/ })).toContainText('Needs you');
    await expect(nav.getByRole('button', { name: /Parts counter/ })).toContainText('Paused');
    await expect(nav.getByRole('button', { name: /Clinic intake/ })).toContainText('Results ready');
    await expect(nav.getByRole('button', { name: /Field notes/ })).toContainText('Stopped');
    await expect(nav.getByRole('button', { name: /Night audit/ })).toContainText('Error');
    // A run whose agent is the person's already has no row: the agent is in the list.
    await expect(nav.getByRole('button', { name: /Front desk/ })).toHaveCount(0);
    await capture(page, `runs-sidebar-${theme}`);

    // Results ready opens the results; a stopped run opens the run, to see what happened.
    await nav.getByRole('button', { name: /Clinic intake/ }).click();
    await expect(page).toHaveURL(new RegExp(`#/runs/${STORY.runId}/report$`));
    await goTo(page, '/');
    await nav.getByRole('button', { name: /Field notes/ }).click();
    await expect(page).toHaveURL(/#\/runs\/run_5\/train$/);
  });
}

test('takes a row away once the person has taken the agent its results were for', async () => {
  const { app, page } = launched;
  await stubEngine(app, { ...HOME_ENGINE, 'graduates:accept': graduate });
  await stubByKey(app, 'reports:get', reports);
  await stubSwitch(
    app,
    'jobs:list',
    { before: SIDEBAR_JOBS, after: SIDEBAR_JOBS_AFTER_ACCEPTING },
    'before',
  );
  await applySettings(page, { theme: 'dark', onboarded: true });
  await goTo(page, '/');
  await expect(agents(page).getByRole('button', { name: /Clinic intake/ })).toContainText(
    'Results ready',
  );
  await agents(page)
    .getByRole('button', { name: /Clinic intake/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${STORY.runId}/report$`));
  await resize(2060);
  await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();

  await flipSwitch(app, 'jobs:list', 'after');
  await page.getByRole('button', { name: 'Start using Service desk' }).click();
  await expect(page).toHaveURL(new RegExp(`#/agents/${STORY.graduateId}/chats/`));
  await expect(agents(page).getByRole('button', { name: /Clinic intake/ })).toHaveCount(0);
  await resize(900);
});

test('lists an agent the moment its run ends, wherever the person is', async () => {
  const { app, page } = launched;
  const running = SIDEBAR_JOBS[0];
  const ready = {
    ...running,
    latestRun: {
      ...running?.latestRun,
      id: FLOW.runId,
      status: 'finished',
      phase: 'done',
      accepted: false,
    },
  };
  // The engine has no agent yet. The person is on the training screen, which has no sidebar.
  await stubEngine(app, HOME_ENGINE);
  await stubSwitch(app, 'graduates:list', { none: [], made: [graduate] }, 'none');
  await stubSwitch(app, 'jobs:list', { training: [running], ready: [ready] }, 'training');
  await stubByKey(app, 'reports:get', reports);
  await applySettings(page, { theme: 'dark', onboarded: true });
  await goTo(page, '/');
  await expect(agents(page).getByRole('button', { name: /^New chat with/ })).toHaveCount(0);

  await goTo(page, `/runs/${FLOW.runId}/train`);
  await expect(page.getByRole('region', { name: 'Current round' })).toBeVisible();
  // The run ends: the engine has made the agent, and says so.
  await flipSwitch(app, 'graduates:list', 'made');
  await flipSwitch(app, 'jobs:list', 'ready');
  await emitRunEvents(app, finished());
  await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/report$`));

  // Back on the home screen, with no restart and no reload: the agent is there, and so are its results.
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(
    agents(page).getByRole('button', { name: /^New chat with Service desk/ }),
  ).toBeVisible();
  await expect(
    agents(page).getByRole('button', { name: /Service desk Results ready/ }),
  ).toBeVisible();
});

for (const theme of THEMES) {
  test(`says why a run is paused, and what puts it right, when it is opened later (${theme})`, async () => {
    const { app, page } = launched;
    await stubRecorded(app, 'runs:resume', null);
    await stubEngine(app, pausedEngine({ keys: { meta: false, openrouter: true } }));
    await applySettings(page, { theme, onboarded: true });
    await resize(TRAIN_HEIGHT);
    await goTo(page, `/runs/${STORY.runId}/train`);

    // Nothing here was watched live: the reason is read from the run itself.
    const notice = page.getByRole('status', { name: 'Training is paused' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Spark has no key saved.');
    await expect(notice).toContainText('When that is put right, press Resume.');
    // The engine's own words wait under Details, and the other lines about the run stay quiet.
    await expect(notice.getByText(KEY_MISSING)).toBeHidden();
    await notice.getByRole('button', { name: 'Details' }).click();
    await expect(notice.getByText(KEY_MISSING)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Current round' })).not.toContainText(
      'No key is saved',
    );
    await capture(page, `train-paused-${theme}`);

    // The fix opens the models in Settings, where the key goes; Resume is still there to try again.
    await notice.getByRole('button', { name: 'Add the key' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('tab', { name: 'Models' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await page.getByRole('button', { name: 'Resume' }).click();
    expect(await recordedCalls(app, 'runs:resume')).toEqual([[STORY.runId]]);
  });
}

test('repeats what the engine said when nothing on this computer explains the pause', async () => {
  const { app, page } = launched;
  const stuck = 'Meta had a problem on its side (HTTP 503). This is usually temporary.';
  await stubEngine(app, pausedEngine({ keys: { meta: true, openrouter: true }, error: stuck }));
  await applySettings(page, { theme: 'dark', onboarded: true });
  await goTo(page, `/runs/${STORY.runId}/train`);
  const notice = page.getByRole('status', { name: 'Training is paused' });
  await expect(notice).toContainText(stuck);
  await expect(notice).toContainText('Press Resume to try again.');
  await expect(notice.getByRole('button')).toHaveCount(0);
});

test('offers to check again when Ollama is not running, and lets go once it is', async () => {
  const { app, page } = launched;
  await stubEngine(app, {
    ...pausedEngine({ detail: { job: LOCAL_JOB }, keys: { meta: true }, local: NOTHING_LOCAL }),
  });
  await applySettings(page, { theme: 'dark', onboarded: true });
  await goTo(page, `/runs/${STORY.runId}/train`);
  const notice = page.getByRole('status', { name: 'Training is paused' });
  await expect(notice).toContainText("Ollama isn't running, so Glimmer can't answer.");
  // It was started while the notice was open: asking again reads the computer afresh, and the
  // next thing in the way, a model Ollama doesn't have yet, is what it says.
  await stubEngine(app, { 'connections:detectLocal': OLLAMA_READY });
  await notice.getByRole('button', { name: 'Check again' }).click();
  await expect(notice).not.toContainText("Ollama isn't running");
  await expect(notice).toContainText("Glimmer isn't downloaded on this computer.");
});

test('offers to download the model when Ollama is running without it', async () => {
  const { app, page } = launched;
  await stubEngine(app, {
    ...pausedEngine({ detail: { job: LOCAL_JOB }, keys: { meta: true }, local: OLLAMA_READY }),
  });
  await applySettings(page, { theme: 'dark', onboarded: true });
  await goTo(page, `/runs/${STORY.runId}/train`);
  const notice = page.getByRole('status', { name: 'Training is paused' });
  await expect(notice).toContainText("Glimmer isn't downloaded on this computer.");
  await expect(notice.getByRole('button', { name: 'Download' })).toBeVisible();
});

for (const theme of THEMES) {
  test(`asks Spark's question inside the round, and shows what became of the answer (${theme})`, async () => {
    const { app, page } = launched;
    await stubRecorded(app, 'mentoring:answer', null);
    await stubEngine(app, askingEngine());
    await applySettings(page, { theme, onboarded: true });
    await resize(TRAIN_HEIGHT);
    await goTo(page, `/runs/${STORY.runId}/train`);

    // The run waits for the person, and says so instead of saying it is paused.
    await expect(page.getByText('Spark has a question for you')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeDisabled();
    const round = page.getByRole('region', { name: 'Current round' });
    await expect(round).toContainText('Round 4: Ask about due dates');
    const form = round.getByRole('form', { name: "Spark's question" });
    await expect(form).toContainText(QUESTION);
    const send = form.getByRole('button', { name: 'Send answer', exact: true });
    await expect(send).toBeDisabled();
    // The question is in the list of rounds, marked as waiting for the person.
    const rounds = page.getByRole('region', { name: 'Rounds' });
    await expect(rounds.getByRole('button', { name: /Ask about due dates/ })).toContainText(
      'Needs you',
    );
    await capture(page, `train-question-${theme}`);

    // Saying that the answer changes what counts as success says what that would do.
    const changes = form.getByRole('checkbox', { name: 'This changes what counts as success' });
    await changes.click();
    await expect(form).toContainText('This run stops here.');
    await expect(
      form.getByRole('button', { name: 'Send answer and stop this run' }),
    ).toBeDisabled();
    await changes.click();
    await expect(form).not.toContainText('This run stops here.');

    // The answer goes through the engine's own route, in the person's words.
    await form.getByRole('textbox', { name: 'Your answer' }).fill(ANSWER);
    await send.click();
    expect(await recordedCalls(app, 'mentoring:answer')).toEqual([
      [STORY.runId, 4, { text: ANSWER, changesCriteria: false }],
    ]);

    // The engine takes it up and the run goes on: the round says what Spark did with it.
    const answer = { text: ANSWER, changesCriteria: false };
    await stubEngine(app, askingEngine(answer));
    await emitRunEvents(app, answerTakenUp(answer));
    await expect(form).toBeHidden();
    await expect(round).toContainText(`You answered: ${ANSWER}`);
    await expect(round).toContainText('Spark kept it as what you meant');
    await expect(rounds.getByRole('button', { name: /Ask about due dates/ })).toContainText(
      'Answered',
    );
    await expect(rounds.getByRole('button', { name: /Ask about due dates/ })).toContainText(
      `Your answer: ${ANSWER}`,
    );
    await capture(page, `train-answered-${theme}`);

    // The round's own page tells the same, with no measurement of a change that was never tried.
    await rounds.getByRole('button', { name: /Ask about due dates/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Round 4: Ask about due dates' });
    await expect(drawer.getByText('Answered', { exact: true })).toBeVisible();
    await expect(drawer).toContainText(QUESTION);
    await expect(drawer).toContainText(`You answered: ${ANSWER}`);
    await expect(drawer).not.toContainText('Measured');
    await expect(drawer).not.toContainText('Nothing changed in this round.');
    await capture(page, `train-question-round-${theme}`);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
}

test('stops the run when the answer changes what counts as success, and says so', async () => {
  const { app, page } = launched;
  await stubRecorded(app, 'mentoring:answer', null);
  await stubEngine(app, askingEngine());
  await applySettings(page, { theme: 'dark', onboarded: true });
  await resize(TRAIN_HEIGHT);
  await goTo(page, `/runs/${STORY.runId}/train`);
  const round = page.getByRole('region', { name: 'Current round' });
  const form = round.getByRole('form', { name: "Spark's question" });
  await form.getByRole('textbox', { name: 'Your answer' }).fill('Yes, it should count.');
  await form.getByRole('checkbox', { name: 'This changes what counts as success' }).click();
  await form.getByRole('button', { name: 'Send answer and stop this run' }).click();
  expect(await recordedCalls(app, 'mentoring:answer')).toEqual([
    [STORY.runId, 4, { text: 'Yes, it should count.', changesCriteria: true }],
  ]);

  const answer = { text: 'Yes, it should count.', changesCriteria: true };
  await stubEngine(app, askingEngine(answer));
  await emitRunEvents(app, answerTakenUp(answer));
  await expect(round).toContainText('this run stopped');
  await expect(round).toContainText('Train again on the changed job.');
  await expect(
    page
      .getByRole('region', { name: 'Rounds' })
      .getByText('Your answer changed what counts as success'),
  ).toBeVisible();
});

test('does not offer to answer a question that its run ended without', async () => {
  const { app, page } = launched;
  await stubEngine(app, endedAskingEngine());
  await applySettings(page, { theme: 'dark', onboarded: true });
  await resize(TRAIN_HEIGHT);
  await goTo(page, `/runs/${STORY.runId}/train`);
  const round = page.getByRole('region', { name: 'Current round' });
  // Nothing could take the answer, so there is no box for it: only what was asked.
  await expect(round.getByRole('form', { name: "Spark's question" })).toHaveCount(0);
  await expect(round).toContainText(`Spark asked: ${QUESTION}`);
  await expect(round).toContainText('Training ended before you answered.');
  const rounds = page.getByRole('region', { name: 'Rounds' });
  await expect(rounds.getByRole('button', { name: /Ask about due dates/ })).toContainText(
    'Not answered',
  );
  await rounds.getByRole('button', { name: /Ask about due dates/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Round 4: Ask about due dates' });
  await expect(drawer.getByText('Not answered', { exact: true })).toBeVisible();
  await expect(drawer).toContainText('Training ended before you answered.');
});

test('says so, and keeps what was typed, when the answer cannot be sent', async () => {
  const { app, page } = launched;
  await stubEngine(app, askingEngine());
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('mentoring:answer');
    ipcMain.handle('mentoring:answer', () => ({
      ok: false,
      error: { message: "Round 4 isn't waiting for an answer." },
    }));
  });
  await applySettings(page, { theme: 'dark', onboarded: true });
  await goTo(page, `/runs/${STORY.runId}/train`);
  const form = page
    .getByRole('region', { name: 'Current round' })
    .getByRole('form', { name: "Spark's question" });
  await form.getByRole('textbox', { name: 'Your answer' }).fill(ANSWER);
  await form.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.getByText("Couldn't send your answer")).toBeVisible();
  await expect(page.getByText("Round 4 isn't waiting for an answer.")).toBeVisible();
  await expect(form.getByRole('textbox', { name: 'Your answer' })).toHaveValue(ANSWER);
  await expect(form.getByRole('button', { name: 'Send answer', exact: true })).toBeEnabled();
});
