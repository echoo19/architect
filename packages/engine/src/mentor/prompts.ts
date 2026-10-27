import type {
  EvaluationConfig,
  MentorCompletionRequest,
  MentorView,
  ReasoningEffort,
} from '@architect/shared';
import { HYPOTHESIS_JSON_SCHEMA } from './reply';
import type { OneShotView } from './view';

/** Room for reasoning plus a change set of a few files. */
export const DIAGNOSE_MAX_OUTPUT_TOKENS = 12_000;
/** Room for reasoning plus a whole harness. */
export const ONE_SHOT_MAX_OUTPUT_TOKENS = 24_000;

export interface PromptSettings {
  evaluation: Pick<EvaluationConfig, 'minDevGain' | 'maxTypeRegression' | 'devRepeats'>;
  reasoningEffort?: ReasoningEffort;
}

const HARNESS_SURFACE = `## The harness

The student runs inside a harness: a folder of plain files. You change the student's behaviour only by editing these files. Each edit either writes a whole file (op "write" with the complete new content) or deletes one (op "delete" with empty content). Paths are relative to the harness folder. Any other path is rejected and the round is lost.

- system.md: the system prompt. Role, scope and operating rules, most important first.
- skills/<slug>.md: a step-by-step procedure, starting with front matter:
  ---
  name: Price a completed job
  summary: One line the student sees in its list of skills.
  task_types: [invoice]
  ---
  The student sees each skill's name and summary and loads the full text with load_skill, unless a retrieval rule loads it up front. Slugs use lowercase letters, digits and dashes.
- tools/<name>.json and tools/<name>.js: a helper tool. The .json file holds {"name", "description", "parameters"}, where parameters is a JSON Schema object for the arguments. The .js file defines function run(args, ctx). Names use lowercase letters, digits and underscores and start with a letter. Always write both files.
- examples/<slug>.json: a worked example the student sees as a past conversation: {"title", "task_types", "messages"}. Each message has exactly one of these shapes, and the last is the assistant's correct ANSWER line:
  {"role": "user", "content": "..."}
  {"role": "assistant", "content": "...", "tool_calls": [{"id": "call_1", "name": "read_table", "arguments": {"file": "..."}}]} (tool_calls only on a turn that calls tools)
  {"role": "tool", "tool_call_id": "call_1", "name": "read_table", "content": "..."} (the result of the call with that id)
- retrieval.yaml: which skills and examples load for which request:
  list_skills: true
  max_loaded_skills: 2
  max_examples: 2
  rules:
    - when_any: [invoice, bill]
      load_skills: [price-a-job]
      load_examples: [after-hours-plan-member]
  when_any matches case-insensitive words or phrases in the request. Rules apply in order until the caps are reached.
- decoding.yaml: temperature, top_p, top_k, max_steps (1 to 40), max_output_tokens (64 to 32768, reasoning included) and thinking (low, medium or high). More thinking or steps can fix reasoning failures but makes every task slower. The runner chooses the sampling seed; it isn't yours to set.
- guardrails.yaml: task types the student must refuse:
  refuse:
    - task_type: scheduling
      when_any: [book, schedule]
      reason: One sentence the user will read.
  A refused task counts as a failure, so refuse a type only when no fix works within the budget. The user then gets an honest refusal instead of a wrong answer.

harness.yaml belongs to the runner. The checker, the data, the task splits, the tool permissions and the student's weights are fixed.`;

const BUILT_IN_TOOLS = `## Built-in tools

Every student has these whatever the harness says, and harness tools are added beside them:
- list_files: the job's data files and what each holds.
- read_table: rows from a table, filtered by where clauses ({column, op, value}, where op is one of = != > >= < <= contains in), with optional columns and limit.
- read_text: the full text of a text file, such as a policy.
- calculate: evaluates an arithmetic expression exactly.
- append_rows and update_rows: change a table the job lets the agent write. During training, writes go to a scratch copy.
- load_skill: loads a skill's full text by slug.`;

const TOOL_RULES = `## Writing a tool

A tool is plain JavaScript that defines function run(args, ctx) and returns JSON-serializable data. There are no imports, no require and no packages. It runs in a sandbox with no network, no clock and no randomness, so take dates from the data or the arguments. ctx is read-only. ctx.readTable(file, { where, columns, limit, offset }) returns every matching row, all of them unless you pass limit, as objects keyed by column name with text values and null for empty cells; file is the data file's name as listed, such as "jobs.csv", and where takes the same filters as read_table. ctx.readText(file) returns a text file's content, and ctx.listFiles() lists the job's files. Throw an Error with a clear message for bad input; the student sees it as a tool error. Write tools for steps the student keeps getting wrong by hand, such as exact arithmetic over many rows, date ranges or conflict checks.`;

const ANSWER_FORMAT = `## How tasks are graded

Every task ends with one line, ANSWER: <json>, in the shape the task asks for. A deterministic checker compares it with the expected result, or checks the end state of the data for tasks that write. A missing or malformed ANSWER line fails, so the format is part of the job.`;

function replyFormat(): string {
  return `## Your reply

Reply with one JSON object: title (at most 80 characters), diagnosis, causeTaskIds, edits (each {op, path, content}: the whole new file for a write, empty content for a delete), predicted {devDeltaMin, devDeltaMax, rationale} and readyClaim.`;
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

The student is small: every line of system prompt and every loaded skill costs it attention and time, so keep the harness lean and specific. A round that doesn't help still spends budget.

Set readyClaim to true only if you expect the harness after this change to meet the job's requirement on tasks you haven't seen. The claim is recorded and checked against the locked test.`;
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

Write a complete harness: a system prompt with the operating rules, a skill for each task type with the exact procedure, tools for computations that are easy to get wrong by hand, worked examples where the format is subtle, and retrieval rules that load the right skill for each request. Base everything on the job description, the data and any policy text. The examples show what correct answers look like; dev and test tasks are different tasks of the same types, so don't hard-code answers.

The student is small: keep the system prompt short and put procedures in skills.

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
    if (file.kind === 'text')
      return `## ${file.name} (text, ${access})\n${fenced(file.text ?? '')}`;
    const rows = (file.sampleRows ?? []).map((row) => JSON.stringify(row)).join('\n');
    return [
      `## ${file.name} (table, ${access}, ${file.rowCount ?? 0} rows)`,
      `Columns: ${(file.columns ?? []).join(', ')}`,
      `First rows:\n${fenced(rows)}`,
    ].join('\n');
  });
  return [
    `# Job: ${job.name}`,
    job.description,
    `Task types:\n${types.join('\n')}`,
    `Requirement: pass at least ${percent(job.requirements.passRate)} of the locked test${latency}.`,
    `# Data files`,
    ...files,
  ].join('\n\n');
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
      `## ${result.taskId} (${result.taskType}): ${result.pass ? 'PASS' : 'FAIL'}`,
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

export function renderMentorView(view: MentorView): string {
  return [
    renderJob(view.job),
    renderHarness(view.harnessFiles),
    `# Round ${view.round}\n${renderBudget(view.budgetLeft)}\nDev with the current harness: ${view.dev.pass}/${view.dev.total} passed.`,
    renderLineage(view.lineage),
    renderTrain(view.train),
  ].join('\n\n');
}

export function renderOneShotView(view: OneShotView): string {
  const examples = view.examples.map((example) =>
    [
      `## ${example.taskId} (${example.taskType})`,
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

function systemPrompt(instructions: string): string {
  return [
    instructions,
    HARNESS_SURFACE,
    BUILT_IN_TOOLS,
    TOOL_RULES,
    ANSWER_FORMAT,
    replyFormat(),
  ].join('\n\n');
}

/** The round's diagnosis request. The self-reflection baseline sends the same one to the student. */
export function diagnoseRequest(
  view: MentorView,
  settings: PromptSettings,
): MentorCompletionRequest {
  return {
    system: systemPrompt(diagnoseInstructions(settings)),
    messages: [{ role: 'user', content: renderMentorView(view) }],
    json: { name: 'hypothesis', schema: HYPOTHESIS_JSON_SCHEMA },
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
    system: systemPrompt(oneShotInstructions(view, settings, refinedLater)),
    messages: [{ role: 'user', content: renderOneShotView(view) }],
    json: { name: 'hypothesis', schema: HYPOTHESIS_JSON_SCHEMA },
    reasoningEffort: settings.reasoningEffort,
    maxOutputTokens: ONE_SHOT_MAX_OUTPUT_TOKENS,
  };
}
