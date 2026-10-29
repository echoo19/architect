import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { MentorConfig, StudentEndpoint, Task } from '@architect/shared';
import { allowMoreTime, goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import {
  startFakeStudent,
  startScriptedMentor,
  type MentorChatBody,
  type ScriptedMentor,
} from './models';
import { shop, type Shop } from './shop';

/*
 * Describing a job in the real app, on the real engine: the person attaches a shop's records, the
 * teacher (a scripted one on this computer) asks a question and drafts, Architect makes the
 * tasks, the Define screen shows them, and training starts on them. Nothing but the teacher and
 * the student's model is a stand-in.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const WIDTH = 1440;
const DEFINE_HEIGHT = 1580;
const THEMES = ['dark', 'light'] as const;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let mentor: ScriptedMentor;
let student: Awaited<ReturnType<typeof startFakeStudent>>;
/** The teacher and model the person set up, which every job they describe starts from. */
let defaultMentor: MentorConfig;
let defaultStudent: StudentEndpoint;
let scratch: string;
let files: string[];
let records: Shop;
/** How many drafting requests the teacher has had in the test that is running. */
let drafting = 0;
let path: 'answer' | 'now' = 'answer';

const DESCRIPTION =
  'Answer questions about the orders and customers of our small online shop: who a customer is, ' +
  'which of their orders are still pending, and what a region ordered in a stretch of time.';
const OPEN_RULE = 'Whether cancelled orders count in the totals.';

const EMPTY_JOB = {
  name: '',
  summary: '',
  description: '',
  does: [],
  doesNot: [],
  businessDate: '',
  passRate: 0,
  files: [],
  unresolved: [],
  taskTypes: [],
};

const NO_TYPE = {
  id: '',
  label: '',
  description: '',
  template: '',
  table: '',
  keyColumn: '',
  columns: [],
  filters: [],
  groupColumn: '',
  measure: '',
  valueColumn: '',
  dateColumn: '',
  dateOrder: '',
  unit: '',
  request: '',
};

/** What the teacher drafts: three kinds of request, one for each template Architect has. */
function draftReply(unresolved: string[]) {
  return {
    action: 'draft',
    message: '',
    options: [],
    job: {
      name: 'Shop desk',
      summary: "Answers questions about the shop's customers and orders.",
      description:
        'Shop desk answers questions about the orders and customers of a small online shop, from its exported records.',
      does: [
        'Looks up what the records say about a customer',
        "Lists a customer's pending orders",
        'Adds up what a region ordered between two dates',
      ],
      doesNot: ['Changes any record', 'Answers from anything but the records'],
      businessDate: '2026-11-24',
      passRate: 0.9,
      files: [
        { name: 'customers.csv', description: 'One row per customer.', access: 'read' },
        { name: 'orders.csv', description: 'One row per order.', access: 'read' },
        { name: 'policy.md', description: "The shop's rules.", access: 'read' },
      ],
      unresolved,
      taskTypes: [
        {
          ...NO_TYPE,
          id: 'email',
          label: 'Customer emails',
          description: 'Look up the email of a customer.',
          template: 'lookup',
          table: 'customers.csv',
          keyColumn: 'customer_id',
          columns: ['email'],
          request: 'What is the email of customer {key}?',
        },
        {
          ...NO_TYPE,
          id: 'pending',
          label: 'Pending orders',
          description: 'List the pending orders of a customer.',
          template: 'filtered_list',
          table: 'orders.csv',
          keyColumn: 'order_id',
          filters: [
            { column: 'status', op: 'equals', value: 'Pending', varies: false },
            { column: 'customer_id', op: 'equals', value: '', varies: true },
          ],
          request: 'Which orders of customer {customer_id} are still pending?',
        },
        {
          ...NO_TYPE,
          id: 'totals',
          label: 'Region totals',
          description: 'Add up the orders of a region between two dates.',
          template: 'group_total',
          table: 'orders.csv',
          groupColumn: 'region',
          measure: 'sum',
          valueColumn: 'amount',
          dateColumn: 'order_date',
          unit: 'as_written',
          request: 'What is the total of orders in the {group} region from {from} to {to}?',
        },
      ],
    },
  };
}

/** One reply of the scripted teacher: drafting turns follow the script, the rest are a harness. */
function reply(request: MentorChatBody): unknown {
  if (request.response_format?.json_schema?.name === 'job_draft') {
    drafting += 1;
    if (drafting === 1) {
      return {
        action: 'ask',
        message: 'Should cancelled orders count in what a region ordered?',
        options: ['Yes, count them', 'No, leave them out'],
        job: EMPTY_JOB,
      };
    }
    return draftReply(path === 'now' ? [OPEN_RULE] : []);
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
  records = shop();
  scratch = await mkdtemp(join(tmpdir(), 'architect-e2e-shop-'));
  await mkdir(scratch, { recursive: true });
  files = [join(scratch, 'customers.csv'), join(scratch, 'orders.csv'), join(scratch, 'policy.md')];
  await writeFile(files[0] as string, records.customersCsv);
  await writeFile(files[1] as string, records.ordersCsv);
  await writeFile(files[2] as string, '# Shop policy\n\nReturns are accepted for 30 days.\n');
  mentor = await startScriptedMentor(reply);
  student = await startFakeStudent();
  defaultMentor = {
    kind: 'model',
    provider: 'lmstudio',
    label: 'Muse Spark 1.3',
    baseUrl: mentor.baseUrl,
    model: 'scripted-spark',
    reasoningEffort: 'medium',
  };
  defaultStudent = {
    runtime: 'openai_compatible',
    baseUrl: student.baseUrl,
    model: 'fake-student',
    contextLength: 16_384,
  };
  launched = await launchApp({
    settings: { onboarded: true, comparisonMode: false, defaultMentor, defaultStudent },
  });
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
  // The pointer would otherwise leave a hover highlight wherever the last click was.
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, `${name}.png`),
    animations: 'disabled',
    timeout: 15_000,
  });
}

/** Describe the job, attach the shop's files, and get to the teacher's first reply. */
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

/** The job's id, from the Define screen's address. */
function jobIdOf(page: Page): string {
  const id = /#\/jobs\/([^/]+)\/define$/.exec(page.url())?.[1];
  if (!id) throw new Error(`This isn't the Define screen: ${page.url()}`);
  return id;
}

/** What the final test holds, which only the test may read from the app's own data folder. */
async function finalTest(page: Page, jobId: string): Promise<Task[]> {
  const { dataPath } = await page.evaluate(() => window.architect.app.info());
  const text = await readFile(join(dataPath, 'vault', jobId, 'test.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Task);
}

/** The text a request carried, whole, for looking for a task in it. */
function sentTo(requests: readonly MentorChatBody[]): string {
  return requests.map((request) => JSON.stringify(request)).join('\n');
}

for (const theme of THEMES) {
  test(`describes a job, answers a question and trains on the tasks it made (${theme})`, async () => {
    const { page } = launched;
    path = 'answer';
    await describe(page, theme);

    // Clarify: the teacher read the files and asks one question, and the app adds a way out.
    const question = page.getByText('Should cancelled orders count in what a region ordered?');
    await expect(question).toBeVisible();
    await expect(page.getByRole('button', { name: 'Yes, count them' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draft it now' })).toBeVisible();
    await capture(page, `drafting-ask-${theme}`);

    const opening =
      mentor.requests[0]?.messages.find((message) => message.role === 'user')?.content ?? '';
    expect(opening).toContain(DESCRIPTION);
    expect(opening).toContain('### customers.csv (a table)');
    expect(opening).toContain('150 rows, 4 columns.');
    expect(opening).toContain('### orders.csv (a table)');
    expect(opening).toContain('400 rows, 6 columns.');
    expect(opening).toContain('Returns are accepted for 30 days.');
    expect(opening).not.toContain(records.customers[149]?.email);

    // Answering drafts the job. A drafted job is reviewed on the next screen, not replied to.
    await page.getByRole('button', { name: 'No, leave them out' }).click();
    const review = page.getByRole('button', { name: 'Review the job' });
    await expect(review).toBeFocused();
    await expect(
      page.getByText("That's everything I need. I've drafted the job for you to review."),
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
    expect(drafting).toBe(2);
    await review.click();

    // Define: the drafted job, and what its tasks are.
    await expect(page).toHaveURL(/#\/jobs\/[^/]+\/define$/);
    const jobId = jobIdOf(page);
    await resize(DEFINE_HEIGHT);
    await expect(page.getByRole('heading', { name: 'Shop desk', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'What it does' })).toContainText(
      "Lists a customer's pending orders",
    );
    await capture(page, `drafting-define-${theme}`);

    await page.getByRole('button', { name: 'Advanced settings' }).click();
    const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
    await advanced.getByRole('tab', { name: 'Example tasks' }).click();
    await expect(
      advanced.getByText('Made by Architect from your files, following the job Spark drafted.'),
    ).toBeVisible();
    await expect(advanced.getByText('120 tasks', { exact: true })).toBeVisible();
    await expect(
      advanced.getByText('40 practice, 30 check, 40 final test, 10 set aside', { exact: true }),
    ).toBeVisible();
    await expect(
      advanced.getByText(
        'Answers are checked against what Spark drafted from your files, not independently certified as right for your business.',
      ),
    ).toBeVisible();
    await expect(advanced.getByRole('region', { name: 'Left open' })).toHaveCount(0);

    // Each type says the rule Architect understood and shows three examples with their answers.
    const emails = advanced.getByRole('region', { name: 'Customer emails' });
    await expect(emails).toContainText('Look up email by customer_id, from customers.csv');
    await expect(emails.getByText(/^Expected answer:/)).toHaveCount(3);
    const pending = advanced.getByRole('region', { name: 'Pending orders' });
    await expect(pending).toContainText(
      'List the order_id in orders.csv where status is Pending, for each customer_id',
    );
    const totals = advanced.getByRole('region', { name: 'Region totals' });
    await expect(totals).toContainText(
      'Total of amount for each region, within a range of dates in order_date, from orders.csv',
    );
    await capture(page, `drafting-tasks-${theme}`);
    await pending.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await capture(page, `drafting-examples-${theme}`);

    // The examples are right: worked out from the records, not from the mess in them. The first
    // request and the first answer of a type are the same example's.
    const asked = await emails
      .getByText(/^What is the email of customer C-\d+\?$/)
      .first()
      .innerText();
    const customer = /customer (C-\d+)\?/.exec(asked)?.[1];
    const mail = records.customers.find((item) => item.id === customer)?.email;
    expect(mail).toBeDefined();
    expect(
      await emails
        .getByText(/^Expected answer:/)
        .first()
        .innerText(),
    ).toBe(`Expected answer: email: ${mail}`);
    const range = await totals
      .getByText(/^What is the total of orders in the \w+ region from/)
      .first()
      .innerText();
    const [, region, from, to] = /in the (\w+) region from (\S+) to (\S+)\?/.exec(range) ?? [];
    expect(region).toBeDefined();
    const cents = records.orders
      .filter(
        (order) =>
          order.region === region && order.date >= (from ?? '') && order.date <= (to ?? ''),
      )
      .reduce((sum, order) => sum + (order.cents ?? 0), 0);
    expect(
      await totals
        .getByText(/^Expected answer:/)
        .first()
        .innerText(),
    ).toBe(`Expected answer: total: ${cents / 100}`);
    await page.keyboard.press('Escape');
    await expect(advanced).toBeHidden();

    // The final test is sealed apart: the teacher never saw any of it, and no example is from it.
    const test = await finalTest(page, jobId);
    expect(test).toHaveLength(40);
    const sent = sentTo(mentor.requests);
    for (const task of test) expect(sent).not.toContain(task.prompt.split('\n')[0]);

    // The job arrived with the teacher and model the person set up, not the ones it was drafted
    // with, so training runs on this computer's stand-ins and never reaches the network.
    const job = await page.evaluate((id) => window.architect.jobs.get(id), jobId);
    expect(job.mentor).toEqual(defaultMentor);
    expect(job.student.local).toEqual(defaultStudent);
    expect(job.student.trainOn).toBe('local');
    expect(job.student.hosted).toBeUndefined();

    // This computer can't fit a round in the four hours a drafted job allows, so Start training
    // waits and says why, with more time one button away.
    await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
    await allowMoreTime(page);

    // Start training: the run works on the tasks Architect made, and the checker grades them.
    await page.getByRole('button', { name: 'Start training' }).click();
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
    const requests = recentAttempts.map((attempt) => attempt.prompt ?? '');
    expect(
      requests.every((text) =>
        /^(What is the email of customer|Which orders of customer|What is the total of orders)/.test(
          text,
        ),
      ),
    ).toBe(true);
    expect(recentAttempts.some((attempt) => attempt.check.reason.includes('expected'))).toBe(true);
    const finalPrompts = new Set(test.map((task) => task.prompt.split('\n')[0]));
    expect(requests.some((text) => finalPrompts.has(text.split('\n')[0] ?? ''))).toBe(false);
    expect(sentTo(mentor.requests)).not.toContain(test[0]?.prompt.split('\n')[0] ?? 'x');
    await page.evaluate((id) => window.architect.runs.stop(id), runId).catch(() => undefined);
  });

  test(`drafts at once when asked to, and says what it left open (${theme})`, async () => {
    const { page } = launched;
    path = 'now';
    await describe(page, theme);
    await expect(
      page.getByText('Should cancelled orders count in what a region ordered?'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Draft it now' }).click();
    const review = page.getByRole('button', { name: 'Review the job' });
    await expect(review).toBeFocused();
    // The teacher is told it must draft, and that it may leave rules open.
    const last = mentor.requests.at(-1);
    expect(last?.messages.at(-1)?.content).toContain('Draft the job now from what you have');
    await expect(
      page.getByText("I couldn't settle this from your files and answers"),
    ).toBeVisible();
    await expect(page.getByText(OPEN_RULE)).toBeVisible();
    await expect(page.getByText("That's everything I need.")).toHaveCount(0);
    await capture(page, `drafting-open-${theme}`);

    await review.click();
    await resize(DEFINE_HEIGHT);
    await expect(page.getByRole('heading', { name: 'Shop desk', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Advanced settings' }).click();
    const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
    await advanced.getByRole('tab', { name: 'Example tasks' }).click();
    const open = advanced.getByRole('region', { name: 'Left open' });
    await expect(open).toContainText(OPEN_RULE);
    await expect(open).toContainText("Spark couldn't settle these from your files and answers.");
    await capture(page, `drafting-tasks-open-${theme}`);
  });
}

test('says what to attach when the files cannot make a job, and puts the description back', async () => {
  const { page, app } = launched;
  const tiny = join(scratch, 'tiny.csv');
  await writeFile(tiny, 'id,name\n1,a\n2,b\n3,c\n');
  await app.evaluate(
    ({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: picked });
    },
    [tiny],
  );
  const before = mentor.requests.length;
  await updateSettings(page, { theme: 'dark' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await resize(900);
  await goTo(page, '/new');
  await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
  await page.getByRole('button', { name: 'Attach files' }).click();
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Your files hold only 3 rows between them')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
  // Nothing was sent to the teacher: there was nothing to make tasks from.
  expect(mentor.requests.length).toBe(before);
  await capture(page, 'drafting-ended-dark');
  await page.getByRole('button', { name: 'Edit the description' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe the job' })).toHaveValue(DESCRIPTION);
  await expect(
    page.getByRole('list', { name: 'Attached files' }).getByRole('listitem'),
  ).toHaveCount(1);
});
