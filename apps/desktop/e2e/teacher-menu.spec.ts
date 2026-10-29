import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Job, MentorConfig } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { NOTHING_LOCAL, stubEngine } from './fixtures';
import {
  startFakeStudent,
  startScriptedMentor,
  type MentorChatBody,
  type ScriptedMentor,
} from './models';

/*
 * What the person lets the teacher change, in the real app on the real engine with a scripted
 * teacher and a student that always answers the same: a kind switched off in the teacher's tab is
 * still off when the job is opened again, the first draft and every later round keep to it, a
 * round that asks for it anyway is refused as the person's choice, and a run whose teacher may
 * change nothing ends before it starts to spend.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const WIDTH = 1440;
const TRAIN_HEIGHT = 1270;
const THEMES = ['dark', 'light'] as const;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let mentor: ScriptedMentor;
let student: Awaited<ReturnType<typeof startFakeStudent>>;
let jobId: string;

/** The teacher on this computer that the job's rounds ask. */
let teacher: MentorConfig;
/** How many first drafts it has been asked for. */
let drafts = 0;

const AGENT_MD = { op: 'write', path: 'AGENTS.md', content: 'Read the records, then answer.' };
const TOOL_EDITS = [
  { op: 'write', path: 'tools/sum.js', content: 'function run() { return 1; }' },
  { op: 'write', path: 'tools/sum.json', content: '{}' },
];

/** A reply in the teacher's format for a whole first harness, with the edits it is given. */
function draft(edits: unknown[]): Record<string, unknown> {
  return {
    title: 'A first setup',
    diagnosis: 'Read the records before answering.',
    causeTaskIds: [],
    edits,
    predicted: { devDeltaMin: 0, devDeltaMax: 1, rationale: 'A first draft.' },
    readyClaim: false,
  };
}

/** The first failed practice task a round's request shows, which a finding has to name. */
function failedTask(request: MentorChatBody): string {
  const text = request.messages.find((message) => message.role === 'user')?.content ?? '';
  const id = /^## (\S+) \(\w+\): FAIL/m.exec(text)?.[1];
  if (id === undefined) throw new Error('The round showed the teacher no failed practice task.');
  return id;
}

/** A round's reply that asks for a small tool, which the person turned off. */
function helperPlan(request: MentorChatBody): unknown {
  return {
    ...draft([AGENT_MD, ...TOOL_EDITS]),
    title: 'Add a tool for the sums',
    findings: [
      {
        taskId: failedTask(request),
        failureTurn: 1,
        evidence: [{ turn: 1, note: 'It answered without adding anything up.' }],
        cause: 'The sums are done by hand.',
        category: { id: '', slug: 'sums-by-hand', label: 'Sums by hand' },
        taskType: 'invoice',
      },
    ],
    intervention: {
      type: 'helper',
      hypothesis: 'A tool would add the lines up exactly.',
      workedExamples: [],
      practicePerFinding: 0,
      question: '',
      estimatedCost: { mentorUsd: 0.01, computeUsd: 0, minutes: 1 },
      verificationPlan: 'Check tasks.',
    },
  };
}

function reply(request: MentorChatBody): unknown {
  const name = request.response_format?.json_schema?.name;
  if (name === 'hypothesis') {
    // The first draft: the first reply writes a tool, which is refused, and the fix does not.
    drafts += 1;
    return drafts === 1 ? draft([AGENT_MD, ...TOOL_EDITS]) : draft([AGENT_MD]);
  }
  if (name === 'diagnosis') return helperPlan(request);
  throw new Error(`The teacher was asked for something unexpected: ${String(name)}.`);
}

test.beforeAll(async () => {
  mentor = await startScriptedMentor(reply);
  student = await startFakeStudent();
  teacher = {
    kind: 'model',
    provider: 'lmstudio',
    label: 'Muse Spark 1.3',
    baseUrl: mentor.baseUrl,
    model: 'scripted-spark',
    reasoningEffort: 'medium',
  };
  launched = await launchApp({
    settings: { onboarded: true, comparisonMode: false, defaultMentor: teacher },
  });
  // Nothing here asks this computer's own model runtimes or graphics card anything: the pre-flight
  // is told there is nothing local, and the job's student is the stand-in above.
  await stubEngine(launched.app, { 'connections:detectLocal': NOTHING_LOCAL });
});

async function capture(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, `${name}.png`),
    animations: 'disabled',
    timeout: 15_000,
  });
}

test.afterAll(async () => {
  await launched?.close();
  await mentor?.close();
  student?.server.close();
});

async function savedJob(page: Page): Promise<Job> {
  return page.evaluate((id) => window.architect.jobs.get(id), jobId);
}

async function openTeacherTab(page: Page) {
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
  await advanced.getByRole('tab', { name: 'Spark' }).click();
  const section = advanced.getByRole('region', { name: 'What Spark may change' });
  await section.scrollIntoViewIfNeeded();
  return { advanced, section };
}

/** Waits for the dialog to say the last edit is saved, then closes it. */
async function closeAdvanced(page: Page, advanced: ReturnType<Page['getByRole']>): Promise<void> {
  await expect(advanced.getByRole('status')).toContainText('Saved');
  await page.keyboard.press('Escape');
  await expect(advanced).toBeHidden();
}

test("a kind switched off in the teacher's tab is still off when the job is opened again", async () => {
  const { page } = launched;
  const sample = await page.evaluate(() => window.architect.jobs.createSample());
  jobId = sample.id;
  expect(sample.interventions).toBeUndefined();
  // The models a run here can reach: the scripted teacher and a student on this computer.
  await page.evaluate((next) => window.architect.jobs.save(next), {
    ...sample,
    mentor: teacher,
    student: {
      label: 'Glimmer',
      local: {
        runtime: 'openai_compatible',
        baseUrl: student.baseUrl,
        model: 'fake-student',
        contextLength: 16_384,
      },
      trainOn: 'local',
    },
  } satisfies Job);

  await goTo(page, `/jobs/${jobId}/define`);
  const { advanced, section } = await openTeacherTab(page);
  const small = section.getByRole('switch', { name: 'Small tools' });
  const questions = section.getByRole('switch', { name: 'Questions for you' });
  for (const name of [
    'Instructions and steps',
    'What it reads, and when',
    'Small tools',
    'Retrain Glimmer itself',
    'Questions for you',
  ]) {
    await expect(section.getByRole('switch', { name: name })).toBeChecked();
  }
  await small.click();
  await questions.click();
  await expect(small).not.toBeChecked();
  await expect(questions).not.toBeChecked();
  await closeAdvanced(page, advanced);
  expect((await savedJob(page)).interventions).toEqual(['procedure', 'retrieval', 'weights']);

  // The app, closed and opened again on the same job, finds the choice where it was left.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/jobs/${jobId}/define`);
  const again = await openTeacherTab(page);
  await expect(again.section.getByRole('switch', { name: 'Small tools' })).not.toBeChecked();
  await expect(again.section.getByRole('switch', { name: 'Questions for you' })).not.toBeChecked();
  await expect(again.section.getByRole('switch', { name: 'Instructions and steps' })).toBeChecked();
  await page.keyboard.press('Escape');
});

test('the last switch that changes the agent stays on, and Start training says when nothing can run', async () => {
  const { page } = launched;
  await goTo(page, `/jobs/${jobId}/define`);
  const { advanced, section } = await openTeacherTab(page);
  await section.getByRole('switch', { name: 'Instructions and steps' }).click();
  await section.getByRole('switch', { name: 'What it reads, and when' }).click();

  // Only the weights are left, and the app already knows they can't be trained here.
  const weights = section.getByRole('switch', { name: 'Retrain Glimmer itself' });
  await expect(weights).toBeChecked();
  await expect(weights).toBeDisabled();
  await expect(section).toContainText(
    'Stays on: the only way left to change the agent. Retraining Glimmer itself needs a Hugging Face key.',
  );
  await closeAdvanced(page, advanced);
  expect((await savedJob(page)).interventions).toEqual(['weights']);

  const needs = page.getByRole('region', { name: 'Before it can start' });
  await expect(needs).toContainText('Spark has nothing it may change');
  await expect(needs).toContainText(
    'Only retraining Glimmer itself is on, and it needs a Hugging Face key.',
  );
  await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
  // The footer says the same, beside the button that is held.
  await expect(page.getByText('Spark has nothing it may change')).toHaveCount(2);
});

test('a run whose teacher may change nothing ends at once, with the reason and no spend', async () => {
  const { page } = launched;
  const before = mentor.requests.length;
  // The button is held; this is the engine's own refusal, as a script or a stale screen would meet.
  const started = await page.evaluate(
    (id) => window.architect.runs.start(id, { method: 'architect', interactive: true }),
    jobId,
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.architect.runs.get(id), started.id)).run.status,
    )
    .toBe('stopped');
  const { run } = await page.evaluate((id) => window.architect.runs.get(id), started.id);
  expect(run.stopReason).toBe('nothing_to_try');
  expect(run.error).toContain(
    "Instructions and steps, What it reads when and Small tools are turned off for this job in the teacher's settings.",
  );
  expect(run.error).toContain('Its weights: ');
  expect(run.totals).toMatchObject({ rounds: 0, attempts: 0, mentorUsd: 0 });
  expect(mentor.requests.length).toBe(before);

  // The Train screen says so, and the run's controls lead back to the job.
  await mkdir(OUT_DIR, { recursive: true });
  for (const theme of THEMES) {
    await updateSettings(page, { theme });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await launched.app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
      { width: WIDTH, height: TRAIN_HEIGHT },
    );
    await goTo(page, `/runs/${started.id}/train`);
    const notice = page.getByRole('status', { name: "Training didn't start" });
    await expect(notice).toBeVisible();
    // In plain words, from the job and what the app knows: what is off, what is missing, and that
    // nothing was spent. None of the engine's words for its own parts.
    await expect(notice).toContainText(
      'Every kind of change Spark may make is turned off for this job, except retraining Glimmer itself, which needs a Hugging Face key. Nothing was spent.',
    );
    await expect(notice).not.toContainText(/mentor|stand-in|adapter|backend/i);
    await capture(page, `teacher-idle-${theme}`);
  }

  // The engine's own sentence is kept under Details.
  const notice = page.getByRole('status', { name: "Training didn't start" });
  await notice.getByRole('button', { name: 'Details' }).click();
  await expect(notice).toContainText('The mentor has nothing it may change in this run.');

  // The way to add the key is Settings, open on the Hugging Face row.
  await notice.getByRole('button', { name: 'Add the Hugging Face key' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('button', { name: 'Add token' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  // Its other button goes to the job with the teacher's tab open.
  await notice.getByRole('button', { name: "Open Spark's settings" }).click();
  await expect(page).toHaveURL(new RegExp(`#/jobs/${jobId}/define$`));
  const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
  await expect(advanced.getByRole('region', { name: 'What Spark may change' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(advanced).toBeHidden();

  // The run's own controls lead back to the job too, without opening anything.
  await goTo(page, `/runs/${started.id}/train`);
  await page.getByRole('button', { name: 'Back to the job' }).click();
  await expect(page).toHaveURL(new RegExp(`#/jobs/${jobId}/define$`));
  await expect(advanced).toBeHidden();
});

test('the first draft and the rounds after it keep to the choice, and a refused round says whose it was', async () => {
  test.setTimeout(240_000);
  const { page } = launched;
  await goTo(page, `/jobs/${jobId}/define`);
  const { advanced, section } = await openTeacherTab(page);
  await section.getByRole('switch', { name: 'Instructions and steps' }).click();
  await section.getByRole('switch', { name: 'What it reads, and when' }).click();
  await expect(section.getByRole('switch', { name: 'Retrain Glimmer itself' })).toBeEnabled();
  await closeAdvanced(page, advanced);
  expect((await savedJob(page)).interventions).toEqual(['procedure', 'retrieval', 'weights']);
  await expect(page.getByRole('region', { name: 'Before it can start' })).toHaveCount(0);

  const before = mentor.requests.length;
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page).toHaveURL(/#\/runs\/[^/]+\/train$/);
  const runId = /#\/runs\/([^/]+)\/train$/.exec(page.url())?.[1] ?? '';
  // The draft, its fix, then a round's diagnosis and its fix.
  await expect
    .poll(() => mentor.requests.length, { timeout: 120_000 })
    .toBeGreaterThanOrEqual(before + 4);

  const [first, fix, round, roundFix] = mentor.requests.slice(before);
  // The teacher is told, in the draft's own instructions, what the person turned off.
  const system = (request: MentorChatBody | undefined) =>
    request?.messages.find((message) => message.role === 'system')?.content ?? '';
  expect(system(first)).toContain(
    "The person turned off part of what you may change for this job, in the teacher's settings: Small tools. Do not write or delete tools/.",
  );
  expect(system(first)).not.toContain('tools for computations that are easy to get wrong by hand');
  // A draft that writes a tool anyway goes back with the reason.
  expect(fix?.messages.at(-1)?.content).toContain(
    'tools/sum.js needs "Small tools", which is turned off for this job in the teacher\'s settings.',
  );
  // Later rounds are offered the kinds that are left, with the person's reason for the others.
  expect(round?.messages.at(-1)?.content).toContain('Allowed this round: procedure, retrieval.');
  expect(system(round)).toContain(
    "- helper is off the menu this round: Turned off for this job in the teacher's settings.",
  );
  expect(system(round)).toContain(
    "- clarification is off the menu this round: Turned off for this job in the teacher's settings.",
  );
  expect(roundFix?.messages.at(-1)?.content).toContain(
    "The mentor chose a helper, which this run can't do. Turned off for this job in the teacher's settings.",
  );

  // The run is held where it is, so the list of rounds stays still while it is read.
  await page.evaluate((id) => window.architect.runs.pause(id), runId);
  await expect
    .poll(
      async () => (await page.evaluate((id) => window.architect.runs.get(id), runId)).run.status,
    )
    .toBe('paused');

  // The round that asked for a tool anyway is listed, and its page says it was the person's choice.
  const rounds = page.getByRole('region', { name: 'Rounds' });
  // A later round asked for it too; the first of them is the one opened.
  const row = rounds.getByRole('button', { name: /Add a tool for the sums/ }).last();
  await row.click();
  const drawer = page.getByRole('dialog').last();
  await expect(drawer).toContainText(
    'Spark chose "Small tools", which is turned off for this job under Spark in Advanced settings. Nothing changed.',
  );
  await page.evaluate((id) => window.architect.runs.stop(id), runId).catch(() => undefined);
});
