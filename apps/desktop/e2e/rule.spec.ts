import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Job, MentorConfig, Task } from '@architect/shared';
import { allowMoreTime, goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { bikeDraft, bikeShop, EMPTY_QUESTION, OPEN_QUESTION, POLICY, type BikeShop } from './bike';
import { stubEngine } from './fixtures';
import { FLOW_LOCAL } from './fixtures-flow';
import {
  startFakeStudent,
  startScriptedMentor,
  type MentorChatBody,
  type ScriptedMentor,
} from './models';

/*
 * A rule in the real app, on the real engine: the person attaches a bike shop's records and its
 * policy, the teacher (a scripted one on this computer) asks what the policy leaves open and
 * drafts, Architect works every answer out itself, and Define puts the rule in front of the person
 * with the passages it came from and examples with their working. Training waits for the person to
 * confirm it, and a record that changes after asks for it again.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const WIDTH = 1440;
const DEFINE_HEIGHT = 2800;
const THEMES = ['dark', 'light'] as const;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let mentor: ScriptedMentor;
let student: Awaited<ReturnType<typeof startFakeStudent>>;
let scratch: string;
let files: string[];
let shop: BikeShop;
/** How many drafting requests the teacher has had in the test that is running. */
let drafting = 0;
let labor = '$65';

const DESCRIPTION =
  'Answer questions about the tickets of our bike repair shop: what a ticket costs under our ' +
  'policy, and who a customer is.';

function reply(request: MentorChatBody): unknown {
  if (request.response_format?.json_schema?.name === 'job_draft') {
    drafting += 1;
    // The first draft rests on something the policy leaves open, so it is asked about instead.
    return bikeDraft(drafting - 1, labor);
  }
  // A training round's request: a plain whole-harness draft, so training has something to measure.
  return {
    title: 'Answer from the records',
    diagnosis: 'A first setup that reads the records before it answers.',
    causeTaskIds: [],
    edits: [{ op: 'write', path: 'AGENTS.md', content: 'Read the records, then answer.' }],
    predicted: { devDeltaMin: 0, devDeltaMax: 1, rationale: 'A first draft.' },
    readyClaim: false,
  };
}

test.beforeAll(async () => {
  shop = bikeShop();
  scratch = await mkdtemp(join(tmpdir(), 'architect-e2e-bike-'));
  files = [
    join(scratch, 'customers.csv'),
    join(scratch, 'tickets.csv'),
    join(scratch, 'policy.md'),
  ];
  await writeFile(files[0] as string, shop.customersCsv);
  await writeFile(files[1] as string, shop.ticketsCsv);
  await writeFile(files[2] as string, shop.policy);
  mentor = await startScriptedMentor(reply);
  student = await startFakeStudent();
  const defaultMentor: MentorConfig = {
    kind: 'model',
    provider: 'lmstudio',
    label: 'Muse Spark 1.3',
    baseUrl: mentor.baseUrl,
    model: 'scripted-spark',
    reasoningEffort: 'medium',
  };
  launched = await launchApp({
    settings: { onboarded: true, comparisonMode: false, defaultMentor },
  });
  // Define asks which models this computer holds before a run starts. This spec answers that
  // itself, so it never reaches this computer's own model runtimes or its graphics card.
  await stubEngine(launched.app, { 'connections:detectLocal': FLOW_LOCAL });
  // The system file dialog is answered in main, so nothing appears on screen.
  await launched.app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: picked });
  }, files);
  await mkdir(OUT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await launched?.close();
  await mentor?.close();
  student?.server.close();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

async function resize(height: number): Promise<void> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) throw new Error('No window');
      main.setContentSize(size.width, size.height);
    },
    { width: WIDTH, height },
  );
  await launched.page.waitForFunction((h) => window.innerHeight === h, height);
}

async function capture(page: Page, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, `${name}.png`),
    animations: 'disabled',
    timeout: 15_000,
  });
}

/** Describe the job with the shop's files and wait for the teacher's first answer. */
async function describe(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  drafting = 0;
  mentor.requests.length = 0;
  await updateSettings(page, { theme });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await resize(900);
  await goTo(page, '/new');
  await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
  await page.getByRole('button', { name: 'Attach files' }).click();
  await expect(
    page.getByRole('list', { name: 'Attached files' }).getByRole('listitem'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Read 3 files')).toBeVisible();
}

function jobIdOf(page: Page): string {
  const id = /#\/jobs\/([^/]+)\/define$/.exec(page.url())?.[1];
  if (!id) throw new Error(`This isn't the Define screen: ${page.url()}`);
  return id;
}

/** The app's own data folder, where the job's records are kept. */
async function dataPath(page: Page): Promise<string> {
  return (await page.evaluate(() => window.architect.app.info())).dataPath;
}

/** What the final test holds, which only the test may read from the app's own data folder. */
async function finalTest(page: Page, jobId: string): Promise<Task[]> {
  const text = await readFile(join(await dataPath(page), 'vault', jobId, 'test.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Task);
}

/** What a ticket costs, in cents, worked out from the records with whole numbers. */
function cost(ticket: string): number {
  const members = new Map(
    shop.customersCsv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => {
        const [id, , , member] = line.split(',');
        return [id, (member ?? '').trim().toLowerCase() === 'yes'] as const;
      }),
  );
  const row = shop.ticketsCsv
    .trim()
    .split('\n')
    .map((line) => line.split(','))
    .find((cells) => cells[0] === ticket);
  if (row === undefined) throw new Error(`There is no ticket ${ticket}.`);
  const halfHours = Math.ceil(Number((row[3] ?? '').trim()) * 2 - 1e-9);
  const labor = halfHours * 3250;
  const paid = members.get(row[1] ?? '') ? halfHours * 2925 : labor;
  return paid + Math.round(Number((row[4] ?? '').replace('$', '')) * 100);
}

/**
 * Answers the teacher's two questions about the rule, the discount and then what a ticket with no
 * parts cost counts as, and goes on to Define. `shot` names a capture of the second.
 */
async function reviewTheJob(page: Page, shot?: string): Promise<string> {
  const question = page.getByText(OPEN_QUESTION.question);
  await expect(question).toBeVisible();
  await page.getByRole('button', { name: 'No, labor only' }).click();
  // About an empty cell the teacher's own options are not used: a rule can only do two things with
  // one, and those are what the person is offered.
  await expect(page.getByText(EMPTY_QUESTION.question)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Count it as zero' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Leave those rows out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zero', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draft it now' })).toHaveCount(0);
  if (shot !== undefined) await capture(page, shot);
  await page.getByRole('button', { name: 'Count it as zero' }).click();
  const review = page.getByRole('button', { name: 'Review the job' });
  await expect(review).toBeFocused();
  await review.click();
  await expect(page).toHaveURL(/#\/jobs\/[^/]+\/define$/);
  await resize(DEFINE_HEIGHT);
  await expect(page.getByRole('heading', { name: 'Repair desk', level: 1 })).toBeVisible();
  return jobIdOf(page);
}

for (const theme of THEMES) {
  test(`asks what the policy leaves open, shows the rule, and trains only after it is confirmed (${theme})`, async () => {
    const { page } = launched;
    labor = '$65';
    await describe(page, theme);

    // The teacher found something the policy doesn't say, and that changes the numbers, so the
    // person is asked, with no way to draft anyway.
    await expect(page.getByText(OPEN_QUESTION.question)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, parts too' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draft it now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review the job' })).toHaveCount(0);
    await capture(page, `rule-question-${theme}`);
    const told = mentor.requests[0]?.messages.find((message) => message.role === 'user')?.content;
    expect(told).toContain('Labor is billed at $65 an hour, in half-hour steps.');
    expect(told).toContain('Members get 10% off labor, never off parts.');

    const jobId = await reviewTheJob(page, `rule-empty-${theme}`);
    expect(drafting).toBe(3);
    const answered = mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(answered).toContain('Answer: No, labor only');
    // What the person chose for an empty parts cost went to the teacher as what Architect does with
    // it, in the words of the choice and not of the options the teacher wrote.
    const emptied = mentor.requests[2]?.messages.at(-1)?.content ?? '';
    expect(emptied).toContain('Answer: Count it as zero');
    expect(emptied).toContain('Architect counts an empty parts_cost in tickets.csv as 0 itself');

    // Define puts the rule first: the passages, the rule in words, the examples and their working.
    const section = page.getByRole('region', { name: 'Check the rule' });
    await expect(section).toBeVisible();
    // What rests on the rule is said in the names the screen uses: Spark read the policy, and
    // Architect grades Glimmer against the answers the rule gives. The lines it quotes are the
    // section "From your policy", and the screen calls them nothing else.
    await expect(section).toContainText(
      'Spark turned your policy into this rule. Architect works out the right answer to every task from this rule and grades Glimmer against those answers, so if the rule is wrong, the grades are wrong too.',
    );
    await expect(section).toContainText('Check that the lines from your policy are the right ones');
    await expect(section.getByText('From your policy', { exact: true })).toBeVisible();
    await expect(section).not.toContainText(/passage/i);
    const card = section.getByRole('article', { name: 'Ticket totals' });
    await expect(
      card.getByText('Labor is billed at $65 an hour, in half-hour steps.'),
    ).toBeVisible();
    await expect(card.getByText('Members get 10% off labor, never off parts.')).toBeVisible();
    await expect(card.getByText('No, labor only', { exact: true })).toBeVisible();
    await expect(card.getByText('Count it as zero', { exact: true })).toBeVisible();
    await expect(card.getByText('your answer', { exact: true })).toHaveCount(2);
    // An answer is read with the question it answered, which the draft kept beside it.
    const discount = card.getByRole('listitem').filter({ hasText: 'No, labor only' });
    await expect(discount.getByText(OPEN_QUESTION.question, { exact: true })).toBeVisible();
    const empty = card.getByRole('listitem').filter({ hasText: 'Count it as zero' });
    await expect(empty.getByText(EMPTY_QUESTION.question, { exact: true })).toBeVisible();
    // The rule in words is a short list of steps, and what the person said an empty parts cost
    // counts as is part of the step that adds it, as the rule they confirm.
    await expect(card.locator('ol').first().locator('> li')).toHaveText([
      '1.Round labor hours up to a multiple of 0.5.',
      '2.Multiply by 65.',
      '3.When member (customers.csv) is yes, take 10% off.',
      '4.Add parts cost. An empty parts cost counts as 0, as you said.',
      '5.Round the result to the nearest cent; half a cent rounds up.',
    ]);
    await expect(card.getByText(/^Start with \(labor hours rounded up/)).toHaveCount(0);
    await expect(
      card.getByText(/^\d+ rows have an empty parts cost, which counts as 0, as you said\.$/),
    ).toBeVisible();
    // Only an empty cell: the tickets whose parts say N/A are still left out, and the line that
    // says how many says why too, when it is the one reason.
    const leftOut = card.getByRole('button', { name: /rows? left out/ });
    await expect(leftOut).toHaveText(
      /^\d+ of \d+ rows left out of the tasks: parts_cost says N\/A or a dash, which is not the same as empty$/,
    );
    await leftOut.click();
    await expect(
      card.getByRole('listitem').filter({
        hasText: /^\d+ rows?: parts_cost says N\/A or a dash, which is not the same as empty/,
      }),
    ).toBeVisible();
    await leftOut.click();
    const examples = card.locator('ul > li').filter({ hasText: /What does ticket|Like T-/ });
    expect(await examples.count()).toBeGreaterThanOrEqual(3);
    await expect(
      card.getByText('member (customers.csv) is yes', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      card.getByText('member (customers.csv) is no', { exact: true }).first(),
    ).toBeVisible();
    await expect(card.getByText(/^Shows how the rule rounds /).first()).toBeVisible();
    await expect(
      card.getByText(/A rounding edge|halves going up|Shows the rounding \(/),
    ).toHaveCount(0);
    // A rounding no record needed is said plainly, beside the example with numbers made up for it.
    await expect(
      card.getByText(
        'None of your records needed rounding to the nearest cent, so no task tests it.',
      ),
    ).toBeVisible();
    await expect(card.getByText(/never changed a value in your records/)).toHaveCount(0);
    // A rounding the records never need is shown with numbers that are not theirs, and says so.
    const notRecord = card.getByText('Not from your records', { exact: true });
    await expect(notRecord).toBeVisible();
    await expect(card.getByText('Made-up numbers')).toHaveCount(0);
    // Its tag comes before what the example shows, and in the body's own ink and not the quiet one
    // of the tags beside it, so "Like T-2144, but with parts cost 0.005" is not taken for a ticket
    // whose price changed.
    const made = card
      .getByRole('listitem')
      .filter({ has: page.getByText('Not from your records', { exact: true }) });
    const shows = made.getByText(/^Shows how the rule rounds /);
    const [tagBox, showsBox] = await Promise.all([notRecord.boundingBox(), shows.boundingBox()]);
    expect(tagBox && showsBox).toBeTruthy();
    expect(tagBox!.x).toBeLessThan(showsBox!.x);
    const color = (tag: Locator) => tag.evaluate((node) => getComputedStyle(node).color);
    expect(await color(notRecord)).not.toBe(await color(shows));
    // The version is not beside the title: it waits under Details, for whoever wants to quote it.
    await expect(card.getByText(/^version [0-9a-f]{12}$/)).toHaveCount(0);
    await card.getByRole('button', { name: 'Details' }).click();
    await expect(card.getByText('Rule version')).toBeVisible();
    await expect(card.getByText(/^[0-9a-f]{12}$/)).toBeVisible();
    await card.getByRole('button', { name: 'Details' }).click();
    // One example is a ticket with no parts cost, shown as nothing and counted as 0.
    await expect(card.getByText('An empty parts cost counts as 0', { exact: true })).toBeVisible();
    await expect(card.getByText('empty (counted as 0)').first()).toBeVisible();

    // Each example is right: worked out again from the records, not from the mess in them.
    let checked = 0;
    for (const example of await examples.all()) {
      const request = await example.locator('span').first().innerText();
      const ticket = /ticket (T-\d+)\b/.exec(request)?.[1];
      if (ticket === undefined) continue;
      const shown = await example.locator('span.tabular-nums').first().innerText();
      expect(shown).toBe(`$${(cost(ticket) / 100).toFixed(2)}`);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(3);

    // The agent only reads these files and has no folder to make files in, so nothing is offered
    // about saving them: a choice about something that cannot happen, and no line that says there
    // is no file while asking what to do about files.
    const permissions = page.getByRole('region', { name: 'Permissions' });
    await expect(permissions).toContainText('Files it can change');
    await expect(permissions).toContainText('None');
    await expect(permissions.getByRole('radiogroup')).toHaveCount(0);
    await expect(permissions).not.toContainText('Saving files');
    await expect(page.getByText('No file it can change')).toHaveCount(0);

    // Not confirmed: training can't start, and the screen says why.
    const start = page.getByRole('button', { name: 'Start training' });
    await expect(start).toBeDisabled();
    await expect(page.getByText('Confirm the rule first')).toBeVisible();
    // A rule that isn't right has a way out: change the description, which comes back as it was
    // with its files, and the line beside the button says so.
    await expect(section.getByRole('button', { name: 'Change the description' })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Describe the job again' })).toHaveCount(0);
    await expect(section).toContainText(
      'Your words and files come back as you left them, and Spark may ask its questions again.',
    );
    await capture(page, `rule-define-${theme}`);

    // The examples are practice or starting tasks: none is a ticket of the final test.
    const test = await finalTest(page, jobId);
    const sealed = new Set(
      test.flatMap((task) => (task.type === 'cost' ? [String(task.meta?.['key'])] : [])),
    );
    expect(sealed.size).toBeGreaterThan(10);
    for (const example of await examples.all()) {
      const request = await example.locator('span').first().innerText();
      const ticket = /ticket (T-\d+)\b/.exec(request)?.[1];
      if (ticket !== undefined) expect(sealed.has(ticket), ticket).toBe(false);
    }
    const sent = mentor.requests.map((item) => JSON.stringify(item)).join('\n');
    for (const task of test) expect(sent).not.toContain(task.prompt.split('\n')[0]);

    // Confirming it is the person's, once, over these records.
    await card.scrollIntoViewIfNeeded();
    await section.getByRole('button', { name: 'Confirm the rule' }).click();
    await expect(section.getByText(/^Confirmed on /)).toBeVisible();
    await expect(section.getByRole('button', { name: 'Confirm the rule' })).toHaveCount(0);
    // The rule is no longer what holds training back. Time is: this computer can't fit a round in
    // four hours, so one callout by the choice says so, with the way out, and Start training waits.
    await expect(page.getByText('Confirm the rule first')).toHaveCount(0);
    await expect(start).toBeDisabled();
    const slow = page.getByRole('status').filter({ hasText: 'Not even one round of teaching' });
    await expect(slow).toContainText(
      'Not even one round of teaching fits in 4 hours on this computer',
    );
    await expect(slow.getByRole('button', { name: 'Allow 7 hours' })).toBeVisible();
    await expect(slow).toContainText('Allowing 7 hours leaves room for one round of teaching.');
    // The round's time is said as a range, which the limit the button names is made from.
    await expect(slow).toContainText(
      /to score the check tasks once, then \d+ h( \d+ min)? to \d+ h( \d+ min)? for each round of teaching\./,
    );
    await capture(page, `rule-confirmed-${theme}`);
    await allowMoreTime(page);
    await expect(slow).toHaveCount(0);
    await expect(start).toBeEnabled();
    await expect(page.getByText('Keep Architect open while it trains')).toBeVisible();

    // The app puts the person's own models on a new job when it arrives; this stands in for that.
    const job = await page.evaluate((id) => window.architect.jobs.get(id), jobId);
    const models: Pick<Job, 'mentor' | 'student'> = {
      mentor: {
        kind: 'model',
        provider: 'lmstudio',
        label: 'Muse Spark 1.3',
        baseUrl: mentor.baseUrl,
        model: 'scripted-spark',
        reasoningEffort: 'medium',
      },
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
    };
    await page.evaluate((next) => window.architect.jobs.save(next), { ...job, ...models });

    await start.click();
    await expect(page).toHaveURL(/#\/runs\/[^/]+\/train$/);
    const runId = /#\/runs\/([^/]+)\/train$/.exec(page.url())?.[1] ?? '';
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.architect.runs.get(id), runId)).recentAttempts.length,
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);
    const { recentAttempts } = await page.evaluate((id) => window.architect.runs.get(id), runId);
    expect(
      recentAttempts.every((attempt) =>
        /^(What does ticket T-\d+ cost the customer\?|What is the email of customer)/.test(
          attempt.prompt ?? '',
        ),
      ),
    ).toBe(true);
    await page.evaluate((id) => window.architect.runs.stop(id), runId).catch(() => undefined);
  });
}

test('asks for the confirmation again when a record changes, or when the files are drafted again', async () => {
  const { page } = launched;
  labor = '$65';
  await describe(page, 'dark');
  const first = await reviewTheJob(page);
  const section = page.getByRole('region', { name: 'Check the rule' });
  await section.getByRole('button', { name: 'Confirm the rule' }).click();
  await expect(section.getByText(/^Confirmed on /)).toBeVisible();
  await allowMoreTime(page);
  await expect(page.getByRole('button', { name: 'Start training' })).toBeEnabled();

  // A record changes on this computer after the person confirmed: the confirmation no longer
  // holds, and the tasks were made from the old file, so the job has to be described again.
  const folder = join(await dataPath(page), 'jobs', first, 'data');
  const original = await readFile(join(folder, 'policy.md'), 'utf8');
  await writeFile(join(folder, 'policy.md'), original.replace('$65', '$70'));
  await goTo(page, '/');
  await goTo(page, `/jobs/${first}/define`);
  const changed = page.getByRole('region', { name: 'Check the rule' });
  await expect(changed.getByText('Changed since you confirmed it')).toBeVisible();
  await expect(changed.getByRole('alert')).toContainText(
    'policy.md is not the file the tasks were made from',
  );
  await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
  await expect(page.getByText('Describe the job again first')).toBeVisible();
  // Confirming can't bring the old tasks back, so there is nothing to confirm; the rule it was
  // confirmed with is folded away until asked for.
  await expect(changed.getByRole('button', { name: 'Confirm the rule' })).toHaveCount(0);
  await expect(changed.getByRole('article', { name: 'Ticket totals' })).toHaveCount(0);
  await capture(page, 'rule-changed-dark');
  await changed.getByRole('button', { name: 'Show the rule it was confirmed with' }).click();
  await expect(changed.getByRole('article', { name: 'Ticket totals' })).toBeVisible();
  await changed.getByRole('button', { name: 'Show the rule it was confirmed with' }).click();

  // Describing the job again puts the description back, and drafts from the records as they are.
  await changed.getByRole('button', { name: 'Describe the job again' }).click();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(page.getByRole('textbox', { name: 'Describe the job' })).toHaveValue(DESCRIPTION);
  await expect(
    page.getByRole('list', { name: 'Attached files' }).getByRole('listitem'),
  ).toHaveCount(3);
  // The policy the person attaches now says $70: a new job, nobody has confirmed its rule.
  labor = '$70';
  await writeFile(files[2] as string, POLICY.replace('$65', '$70'));
  drafting = 0;
  await page.getByRole('button', { name: 'Send' }).click();
  const second = await reviewTheJob(page);
  expect(second).not.toBe(first);
  const again = page.getByRole('region', { name: 'Check the rule' });
  await expect(
    again.getByText('Labor is billed at $70 an hour, in half-hour steps.'),
  ).toBeVisible();
  await expect(again.getByRole('button', { name: 'Confirm the rule' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
  await writeFile(files[2] as string, shop.policy);
});
