import {
  fileOffLimits,
  HARNESS_INTERVENTIONS,
  INTERVENTION_LABELS,
  type EvaluationConfig,
  type InterventionType,
  type MentorCompletionRequest,
  type MentorView,
  type ReasoningEffort,
} from '@architect/shared';
import { diagnosisJsonSchema, HYPOTHESIS_JSON_SCHEMA } from './reply';
import type { OneShotView } from './view';

/** Room for reasoning plus a change set of a few files. */
export const DIAGNOSE_MAX_OUTPUT_TOKENS = 12_000;
/** Room for reasoning plus a whole harness. */
export const ONE_SHOT_MAX_OUTPUT_TOKENS = 24_000;

export interface PromptSettings {
  evaluation: Pick<EvaluationConfig, 'minDevGain' | 'maxTypeRegression' | 'devRepeats'>;
  reasoningEffort?: ReasoningEffort;
  /** What the job lets the author change; absent means everything. */
  allowed?: readonly InterventionType[];
}

const HARNESS_SURFACE = `## The harness

The student runs inside a harness: a folder of plain files. You change the student's behaviour only by editing these files. Each edit either writes a whole file (op "write" with the complete new content) or deletes one (op "delete" with empty content). Paths are relative to the harness folder. Any other path is rejected and the round is lost.

- AGENTS.md: the standing instructions that open the student's system prompt. Role, scope and operating rules, most important first.
- skills/<name>/SKILL.md: a step-by-step procedure, starting with front matter:
  ---
  name: price-a-job
  description: One line the student sees in its list of skills, saying what the skill is for.
  ---
  The steps follow in Markdown. name is the folder's name, in lowercase letters, digits and dashes. The student sees each skill's name and description, and reads the whole file with read when it needs the steps, unless a retrieval rule puts the steps in its system prompt up front.
- tools/<name>.json and tools/<name>.js: a helper tool. The .json file holds {"name", "description", "parameters"}, where parameters is a JSON Schema object for the arguments. The .js file defines function run(args, ctx). Names use lowercase letters, digits and underscores and start with a letter. Always write both files.
- examples/<slug>.json: a worked example the student sees as a past conversation: {"title", "task_types", "messages"}. Each message has exactly one of these shapes, and the last is the assistant's correct ANSWER line:
  {"role": "user", "content": "..."}
  {"role": "assistant", "content": "...", "tool_calls": [{"id": "call_1", "name": "grep", "arguments": {"pattern": "...", "path": "data/..."}}]} (tool_calls only on a turn that calls tools)
  {"role": "tool", "tool_call_id": "call_1", "name": "grep", "content": "..."} (the result of the call with that id)
- retrieval.yaml: which skills and examples load for which request:
  list_skills: true
  max_loaded_skills: 2
  max_examples: 2
  rules:
    - when_any: [invoice, bill]
      load_skills: [price-a-job]
      load_examples: [after-hours-plan-member]
  load_skills names skills by their folder. when_any matches case-insensitive words or phrases in the request. Rules apply in order until the caps are reached.
- decoding.yaml: temperature, top_p, top_k, max_steps (1 to 40), max_output_tokens (64 to 32768, reasoning included) and thinking (low, medium or high). More thinking or steps can fix reasoning failures but makes every task slower. The runner chooses the sampling seed; it isn't yours to set.
- guardrails.yaml: task types the student must refuse:
  refuse:
    - task_type: scheduling
      when_any: [book, schedule]
      reason: One sentence the user will read.
  A refused task counts as a failure, so refuse a type only when no fix works within the budget. The user then gets an honest refusal instead of a wrong answer.

harness.yaml belongs to the runner. The checker, the data, the task splits, the tool permissions and the student's weights are fixed.`;

/** The parts of a harness, each with a file the job's choice is asked about and what a draft holds. */
const HARNESS_PARTS: readonly { files: string; sample: string; draft: string }[] = [
  { files: 'AGENTS.md', sample: 'AGENTS.md', draft: 'AGENTS.md with the operating rules' },
  {
    files: 'skills/',
    sample: 'skills/x/SKILL.md',
    draft: 'a skill for each task type with the exact procedure',
  },
  {
    files: 'tools/',
    sample: 'tools/x.js',
    draft: 'tools for computations that are easy to get wrong by hand',
  },
  {
    files: 'examples/',
    sample: 'examples/x.json',
    draft: 'worked examples where the format is subtle',
  },
  {
    files: 'retrieval.yaml',
    sample: 'retrieval.yaml',
    draft: 'retrieval rules that load the right skill for each request',
  },
];

/** The parts of a harness the job lets the author write, or all of them when it says nothing. */
function writable(settings: PromptSettings): typeof HARNESS_PARTS {
  const { allowed } = settings;
  if (allowed === undefined) return HARNESS_PARTS;
  return HARNESS_PARTS.filter(
    ({ sample }) => fileOffLimits([sample], { interventions: allowed }) === null,
  );
}

/**
 * The harness, and what of it the person turned off for this job (decision 063). The runner
 * refuses a change set that writes or deletes a file of a kind that is off, whatever the change is
 * called, so the author is told which, with the first draft as much as any later round.
 */
function harnessSurface(settings: PromptSettings): string {
  const open = writable(settings);
  const { allowed } = settings;
  if (allowed === undefined || open.length === HARNESS_PARTS.length) return HARNESS_SURFACE;
  const barred = HARNESS_PARTS.filter((part) => !open.includes(part)).map(({ files }) => files);
  const off = HARNESS_INTERVENTIONS.filter((type) => !allowed.includes(type)).map(
    (type) => INTERVENTION_LABELS[type],
  );
  return `${HARNESS_SURFACE}

The person turned off part of what you may change for this job, in the teacher's settings: ${off.join(', ')}. Do not write or delete ${barred.join(', ')}. The runner refuses a change set that does, whatever you call the change.`;
}

const BUILT_IN_TOOLS = `## The student's folder and tools

The student works like a coding agent in a folder of its own. data/ holds the job's files, so the data file orders.csv is data/orders.csv; output/ is there when the job lets the student create files; skills/ holds the harness's skills, read-only. Every student has these tools whatever the harness says, and harness tools are added beside them:
- read: a file's lines, numbered, about 8,000 characters at a time, with the offset to read on from.
- ls: a folder's files, each with its kind (table or text), size in lines and whether the student can change it.
- glob: the files whose path matches a pattern, like data/*.csv.
- grep: the lines that match a regular expression, as path:line: text, in a file or a folder.
- write, edit and append: change a file the job lets the student change. write replaces the whole text, edit replaces exact text that must match once, and append adds lines at the end. A table must stay valid CSV with its header. During training, changes go to a scratch copy.
- run: JavaScript in a sandbox, with files.read(path) and files.list(folder) (read-only), csv.parse(text) (rows as objects of strings, "" for an empty cell), csv.stringify(rows), today (the working date) and print. It returns what the code printed and the value of its last line. Filtering, joining and adding up rows in run is far more reliable than doing it by eye.`;

const TOOL_RULES = `## Writing a tool

A tool is plain JavaScript that defines function run(args, ctx) and returns JSON-serializable data. There are no imports, no require and no packages. It runs in a sandbox with no network, no clock and no randomness, so take dates from the data or the arguments. ctx is read-only. ctx.readTable(file, { where, columns, limit, offset }) returns every matching row, all of them unless you pass limit, as objects keyed by column name with text values and null for empty cells; file is the data file's name as listed, such as "jobs.csv", and where is a list of filters {column, op, value}, where op is one of = != > >= < <= contains in. ctx.readText(file) returns a text file's content, and ctx.listFiles() lists the job's files. Throw an Error with a clear message for bad input; the student sees it as a tool error. Write tools for steps the student keeps getting wrong by hand, such as exact arithmetic over many rows, date ranges or conflict checks.`;

const ANSWER_FORMAT = `## How tasks are graded

Every task ends with one line, ANSWER: <json>, in the shape the task asks for. A deterministic checker compares it with the expected result, or checks the end state of the data for tasks that write. A missing or malformed ANSWER line fails, so the format is part of the job.`;

function replyFormat(): string {
  return `## Your reply

Reply with one JSON object: title (at most 80 characters), diagnosis, causeTaskIds, edits (each {op, path, content}: the whole new file for a write, empty content for a delete), predicted {devDeltaMin, devDeltaMax, rationale} and readyClaim.`;
}

const MENU_ENTRIES: Record<InterventionType, string> = {
  procedure:
    'procedure: a rule or a step-by-step procedure, in AGENTS.md or a skill, for a workflow that skips a check or a step.',
  retrieval:
    'retrieval: which skill, example or source loads for which request (retrieval.yaml, skills, examples), when the student lacks a fact or reads the wrong source.',
  helper:
    'helper: a small typed tool for a deterministic operation the student keeps getting wrong by hand. A tool reads the data and computes; it can ask for no new access.',
  weights:
    'weights: train the student on verified corrections of your findings, when it keeps misreading requests or choosing wrong actions despite clear instructions. No edits; the harness stays as it is, and the adapter is measured with and without itself.',
  clarification:
    'clarification: one question for the person, when the request or what they want is ambiguous. No edits. Their answer is recorded before any correction is made.',
};

/** How findings and the intervention menu work, for a mentor choosing from the menu. */
function menuInstructions(mentoring: NonNullable<MentorView['mentoring']>): string {
  const allowed = mentoring.allowed.map((type) => `- ${MENU_ENTRIES[type]}`);
  const refused = Object.entries(mentoring.refused).map(
    ([type, reason]) => `- ${type} is off the menu this round: ${reason}`,
  );
  return `## Findings and the intervention menu

The traces number the student's model turns: [turn 3] is its third reply, with the tool calls it made and their results indented under it. For up to three failed train attempts, write a finding: the task id, the turn you suspect went wrong (failureTurn), evidence that points at turns, the cause, a category and the task type. A finding is a suspicion, not proof. To teach from it, the runner rebuilds the state just before that turn by replaying the attempt's own tool calls, and you continue from there as the agent, with the student's tools and the task alone; only a continuation the checker passes, with every write along the way checked too, becomes a lesson. If that can't be done, it tries one turn earlier, then the whole task from the start, and says so.

For a category, reuse an existing id when the failure fits it; otherwise leave id empty and give a new short slug and label. Caps on lessons count by category and by task type, and a category's teaching stops after two rounds without a dev gain.

Then choose exactly one intervention:
${allowed.join('\n')}
${refused.length > 0 ? `${refused.join('\n')}\n` : ''}
For procedure, retrieval and helper, edits hold the change set. workedExamples lists words in requests that should load this round's verified corrections as worked examples (empty adds none), and practicePerFinding asks for that many other train tasks of the same task type to be demonstrated from the start, 0 to 3. For weights, give findings and leave edits empty. For a clarification, give the question and leave edits and findings empty.

estimatedCost is your estimate of mentor dollars, compute dollars and minutes; the runner refuses an intervention whose estimate is more than what is left. verificationPlan says how the result should be checked. Prefer the cheapest intervention the evidence supports.`;
}

function renderMenuSection(mentoring: NonNullable<MentorView['mentoring']>): string {
  const categories =
    mentoring.categories.length === 0
      ? 'The job has no failure categories yet.'
      : mentoring.categories
          .map(
            (category) =>
              `- ${category.id}: ${category.slug} (${category.label}), ${category.taskType}, ${category.verifiedLessons} verified lessons${category.stopped ? ', stopped' : ''}`,
          )
          .join('\n');
  const answers =
    mentoring.answers.length === 0
      ? ''
      : `\n\n# The person's answers\n${mentoring.answers.map((item) => `- Q: ${item.question}\n  A: ${item.answer}`).join('\n')}`;
  return `# Failure categories\n${categories}${answers}${renderLessons(mentoring.lessons ?? [])}\n\nAllowed this round: ${mentoring.allowed.join(', ')}.`;
}

type ViewLessons = NonNullable<NonNullable<MentorView['mentoring']>['lessons']>;

/** The person's queued lessons, in a run that improves an agent from them. */
function renderLessons(lessons: ViewLessons): string {
  if (lessons.length === 0) return '';
  const items = lessons.map((item) => {
    const type = item.taskType === undefined ? '' : ` (${item.taskType})`;
    const lines = [`- ${item.kind}${type}: ${item.lesson}`, `  They said: ${item.wrong}`];
    if (item.wanted !== undefined) lines.push(`  They wanted: ${item.wanted}`);
    if (item.instruction !== undefined) lines.push(`  Proposed instruction: ${item.instruction}`);
    return lines.join('\n');
  });
  return `\n\n# The person's lessons\nThis run improves an agent the person already uses. They corrected some of its replies, and each correction became a lesson. Teach what they ask where this round's train failures agree with it; a lesson never overrides the checker, and a rule must stay general.\n${items.join('\n')}`;
}

function replyFormatWithMenu(): string {
  return `## Your reply

Reply with one JSON object: title (at most 80 characters), diagnosis, causeTaskIds, edits (each {op, path, content}), predicted {devDeltaMin, devDeltaMax, rationale}, readyClaim, findings (each {taskId, failureTurn, evidence [{turn, note}], cause, category {id, slug, label}, taskType}) and intervention {type, hypothesis, workedExamples, practicePerFinding, question, estimatedCost {mentorUsd, computeUsd, minutes}, verificationPlan}.`;
}

function diagnoseInstructions(settings: PromptSettings): string {
  const { minDevGain, maxTypeRegression, devRepeats } = settings.evaluation;
  const loss = maxTypeRegression * devRepeats;
  const passes = loss === 1 ? 'pass' : 'passes';
  const evaluation =
    devRepeats === 1
      ? 'evaluates it on dev with the same seeds as the current version'
      : `evaluates it on dev ${devRepeats} times, with the same seeds as the current version; dev scores add up all ${devRepeats} runs`;
  return `You are the mentor for a small local model, the student. The student attempts tasks for the job below inside a harness that you write, and a deterministic checker grades each attempt pass or fail with a reason. Your job is to improve the harness until the student passes on its own.

Each round you see this round's train attempts with the checker's reasons and a compact trace of each, the train results per task type, the current harness files, the student's overall dev score and your earlier hypotheses with their outcomes. Dev tasks are hidden apart from that one score, and the locked test is never shown.

This round:
1. Read the failing traces and find the root cause shared by the most failures: a missing rule, a procedure the student gets wrong, a computation it can't do reliably by hand, a format slip. Prefer a cause you can point to in the traces over a guess.
2. Propose exactly one hypothesis: one diagnosis and the change set that tests it. A change set may touch several files, but every edit serves that one diagnosis.
3. Predict the effect as a range of net dev passes, devDeltaMin to devDeltaMax, and explain it.
4. Don't repeat a reverted hypothesis unless the new change is meaningfully different, and say how. A rejected round never reached dev: fix what its reason names first.
5. If every train attempt passed, strengthen what the traces show is still fragile.

The runner applies your change set to a new harness version and ${evaluation}. If dev passes rise by at least ${minDevGain * devRepeats} and no task type loses more than ${loss} ${passes}, it measures both versions again under new seeds and keeps the change only if the totals over both measurements rise by at least ${2 * minDevGain * devRepeats} with ${loss === 0 ? 'no task type losing a pass' : `no task type losing more than ${2 * loss}`}; otherwise it is reverted and logged as a failed hypothesis. Dev and test tasks are different tasks of the same types, so write rules that generalize, never answers for particular train tasks.

The student is small: every line of AGENTS.md and every loaded skill costs it attention and time, so keep the harness lean and specific. A round that doesn't help still spends budget.

Set readyClaim to true only if you expect the harness after this change to meet the job's requirement on tasks you haven't seen. The claim is recorded and checked against the locked test.`;
}

/** What a first draft holds, less whatever of it the person turned off for this job. */
function whatToWrite(settings: PromptSettings): string {
  const kept = writable(settings).map(({ draft }) => draft);
  const last = kept.at(-1);
  if (kept.length < 2 || last === undefined) return kept.join('');
  return kept.length === 2 ? kept.join(' and ') : `${kept.slice(0, -1).join(', ')}, and ${last}`;
}

function oneShotInstructions(
  view: OneShotView,
  settings: PromptSettings,
  refinedLater: boolean,
): string {
  const { devRepeats } = settings.evaluation;
  const outOf =
    devRepeats === 1
      ? `out of ${view.devTotal} dev tasks`
      : `out of ${view.devTotal * devRepeats} dev attempts (${view.devTotal} tasks, each run ${devRepeats} times)`;
  const after = refinedLater
    ? "You haven't seen the student attempt anything yet. In the rounds after this one you will see its attempts and refine this harness one change at a time."
    : "You won't see the student attempt anything, and you get one reply.";
  return `You are the mentor for a small local model, the student. Write its whole harness in one go from the job setup and the train examples with their expected answers. ${after}

Write a complete harness: ${whatToWrite(settings)}. Base everything on the job description, the data and any policy text. The examples show what correct answers look like; dev and test tasks are different tasks of the same types, so don't hard-code answers.

The student is small: keep AGENTS.md short and put procedures in skills.

In your reply, title names the harness, diagnosis explains the main risks you designed for, causeTaskIds is empty, and predicted is your expected change in dev passes over the starting harness, ${outOf}. Set readyClaim to true only if you expect the requirement to be met on unseen tasks.`;
}

/** A Markdown fence longer than any run of backticks inside the content. */
function fenced(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${content}\n${fence}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function renderJob(job: MentorView['job']): string {
  const types = job.taskTypes.map(
    (type) => `- ${type.id} (${type.label})${type.description ? `: ${type.description}` : ''}`,
  );
  const latency = job.requirements.p95LatencyMs
    ? `, with 95% of answers within ${(job.requirements.p95LatencyMs / 1000).toFixed(0)} s`
    : '';
  const files = job.dataFiles.map((file) => {
    const access = file.access === 'write' ? 'writable' : 'read-only';
    const at = file.org === undefined ? '' : ` at ${file.org}`;
    if (file.kind === 'text')
      return `## data/${file.name}${at} (text, ${access})\n${fenced(file.text ?? '')}`;
    const rows = (file.sampleRows ?? []).map((row) => JSON.stringify(row)).join('\n');
    return [
      `## data/${file.name}${at} (table, ${access}, ${file.rowCount ?? 0} rows)`,
      `Columns: ${(file.columns ?? []).join(', ')}`,
      `First rows:\n${fenced(rows)}`,
    ].join('\n');
  });
  return [
    `# Job: ${job.name}`,
    job.description,
    `Task types:\n${types.join('\n')}`,
    `Requirement: pass at least ${percent(job.requirements.passRate)} of the locked test${latency}.`,
    ...(job.organizations === undefined ? [] : [renderOrganizations(job.organizations)]),
    `# Data files`,
    ...files,
  ].join('\n\n');
}

/**
 * For a job with organizations: one agent serves them all, and every fact comes from the files
 * of the organization a request is for (decision 068).
 */
function renderOrganizations(orgs: NonNullable<MentorView['job']['organizations']>): string {
  const listed = orgs.map((org) => `- ${org.id}: ${org.name}`).join('\n');
  return `# Organizations
The agent serves several organizations with one harness:
${listed}
Each task is for one of them, and its data/ holds that organization's own files: the same file names, with its own records, labels and policy. Teach the agent to read every fact and policy number from data/ for the request in front of it. Never write one organization's facts, labels or numbers into the harness: the change is refused, and the agent must also serve organizations that are not listed here.`;
}

function renderHarness(files: Record<string, string>): string {
  const entries = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    '# Current harness',
    ...entries.map(([path, content]) => `## ${path}\n${fenced(content)}`),
  ].join('\n\n');
}

function renderBudget(budget: MentorView['budgetLeft']): string {
  return `Budget left: ${budget.rounds} rounds, $${budget.usd.toFixed(2)} of mentor spend, ${Math.floor(budget.minutes)} minutes.`;
}

function renderLineageItem(item: MentorView['lineage'][number]): string {
  if (item.decision === 'rejected') {
    const what =
      item.title === undefined ? 'the reply held no usable hypothesis.' : `${item.title}.`;
    const files = item.files.length > 0 ? ` Files: ${item.files.join(', ')}.` : '';
    return `- Round ${item.round}, rejected before dev saw it: ${what}${files} Why: ${item.reason}`;
  }
  const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));
  const again =
    item.confirmedDelta === undefined
      ? ''
      : `; measured again, ${signed(item.confirmedDelta)} over both`;
  return `- Round ${item.round}, ${item.decision} (dev ${signed(item.devDelta)}${again}): ${item.title}. ${item.diagnosis} Files: ${item.files.join(', ')}.`;
}

function renderLineage(lineage: MentorView['lineage']): string {
  if (lineage.length === 0) return '# Earlier hypotheses\nNone yet.';
  return `# Earlier hypotheses\n${lineage.map(renderLineageItem).join('\n')}`;
}

function renderTrain(train: MentorView['train']): string {
  const passed = train.results.filter((result) => result.pass).length;
  const perType = train.perType.map((type) => `${type.type} ${type.pass}/${type.total}`).join(', ');
  const attempts = train.results.map((result) =>
    [
      `## ${result.taskId} (${result.taskType}${result.org === undefined ? '' : ` at ${result.org}`}): ${result.pass ? 'PASS' : 'FAIL'}`,
      `Checker: ${result.reason}`,
      `Request:\n${fenced(result.prompt)}`,
      `Expected:\n${fenced(JSON.stringify(result.expected, null, 2))}`,
      `Trace:\n${fenced(result.trace)}`,
    ].join('\n'),
  );
  return [
    `# Train attempts this round: ${passed}/${train.results.length} passed`,
    `Per type: ${perType}`,
    ...attempts,
  ].join('\n\n');
}

function renderCounterexamples(
  counterexamples: NonNullable<MentorView['counterexamples']>,
): string {
  const suite = Object.entries(counterexamples.suite)
    .map(([helper, count]) => `tools/${helper}.js: ${count}`)
    .join(', ');
  const cases = counterexamples.cases.map((example) =>
    [
      `## ${example.helper}, from ${example.taskId}: ${example.originalRows} rows reduced to ${example.reducedRows}`,
      `Failure: ${example.failure}.`,
      `Arguments:\n${fenced(JSON.stringify(example.arguments))}`,
      `Tables it still fails on:\n${fenced(JSON.stringify(example.tables, null, 2))}`,
      example.texts.length === 0
        ? ''
        : `Text files it was given whole: ${example.texts.join(', ')}`,
    ]
      .filter((line) => line !== '')
      .join('\n'),
  );
  return [
    '# Counterexamples',
    'A helper you wrote failed on these train attempts. Each call was replayed in the sandbox and its tables cut down while it still fails the same way. A change to a helper is kept only if it passes every case of that helper: the reduced case, the original attempt, and every earlier counterexample of this field.',
    suite === '' ? '' : `Cases per helper: ${suite}.`,
    ...cases,
  ]
    .filter((line) => line !== '')
    .join('\n\n');
}

export function renderMentorView(view: MentorView): string {
  return [
    renderJob(view.job),
    renderHarness(view.harnessFiles),
    `# Round ${view.round}\n${renderBudget(view.budgetLeft)}\nDev with the current harness: ${view.dev.pass}/${view.dev.total} passed.`,
    renderLineage(view.lineage),
    renderTrain(view.train),
    ...(view.counterexamples === undefined ||
    (view.counterexamples.cases.length === 0 &&
      Object.keys(view.counterexamples.suite).length === 0)
      ? []
      : [renderCounterexamples(view.counterexamples)]),
  ].join('\n\n');
}

export function renderOneShotView(view: OneShotView): string {
  const examples = view.examples.map((example) =>
    [
      `## ${example.taskId} (${example.taskType}${example.org === undefined ? '' : ` at ${example.org}`})`,
      `Request:\n${fenced(example.prompt)}`,
      `Expected:\n${fenced(JSON.stringify(example.expected, null, 2))}`,
    ].join('\n'),
  );
  return [
    renderJob(view.job),
    renderHarness(view.harnessFiles),
    `# Budget\n${renderBudget(view.budgetLeft)}`,
    `# Train examples\n\n${examples.join('\n\n')}`,
  ].join('\n\n');
}

function systemPrompt(instructions: string, settings: PromptSettings): string {
  return [
    instructions,
    harnessSurface(settings),
    BUILT_IN_TOOLS,
    TOOL_RULES,
    ANSWER_FORMAT,
    replyFormat(),
  ].join('\n\n');
}

/**
 * The round's diagnosis request. The self-reflection baseline sends the same one to the student.
 * A view that carries the intervention menu asks for findings and one intervention from it.
 */
export function diagnoseRequest(
  view: MentorView,
  settings: PromptSettings,
): MentorCompletionRequest {
  const { mentoring } = view;
  if (mentoring === undefined) {
    return {
      system: systemPrompt(diagnoseInstructions(settings), settings),
      messages: [{ role: 'user', content: renderMentorView(view) }],
      json: { name: 'hypothesis', schema: HYPOTHESIS_JSON_SCHEMA },
      reasoningEffort: settings.reasoningEffort,
      maxOutputTokens: DIAGNOSE_MAX_OUTPUT_TOKENS,
    };
  }
  const system = [
    diagnoseInstructions(settings),
    menuInstructions(mentoring),
    harnessSurface(settings),
    BUILT_IN_TOOLS,
    TOOL_RULES,
    ANSWER_FORMAT,
    replyFormatWithMenu(),
  ].join('\n\n');
  return {
    system,
    messages: [
      { role: 'user', content: `${renderMentorView(view)}\n\n${renderMenuSection(mentoring)}` },
    ],
    json: { name: 'diagnosis', schema: diagnosisJsonSchema(mentoring.allowed) },
    reasoningEffort: settings.reasoningEffort,
    maxOutputTokens: DIAGNOSE_MAX_OUTPUT_TOKENS,
  };
}

/** The one-shot baseline's single request: a whole harness, written without seeing attempts. */
/**
 * A whole harness written from the job setup and train examples. `refinedLater` is true for the
 * first round of a run that refines it afterwards, false for the one-shot method.
 */
export function oneShotRequest(
  view: OneShotView,
  settings: PromptSettings,
  refinedLater = false,
): MentorCompletionRequest {
  return {
    system: systemPrompt(oneShotInstructions(view, settings, refinedLater), settings),
    messages: [{ role: 'user', content: renderOneShotView(view) }],
    json: { name: 'hypothesis', schema: HYPOTHESIS_JSON_SCHEMA },
    reasoningEffort: settings.reasoningEffort,
    maxOutputTokens: ONE_SHOT_MAX_OUTPUT_TOKENS,
  };
}
