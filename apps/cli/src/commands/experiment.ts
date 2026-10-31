import { existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { renderComparisonMarkdown } from '@architect/engine';
import {
  ArmIdSchema,
  CodedError,
  defaultExperimentSettings,
  EXPERIMENT_FORMAT,
  EXPERIMENT_LIST_FORMAT,
  EXPERIMENT_PLAN_FORMAT,
  EXPERIMENT_REPORT_FORMAT,
  EXPERIMENT_STATUS_FORMAT,
  ExperimentDocSchema,
  ExperimentGroupSchema,
  ExperimentListDocSchema,
  ExperimentPlanDocSchema,
  ExperimentReportDocSchema,
  ExperimentStartSchema,
  ExperimentStatusDocSchema,
  type ArmId,
  type CliOutcome,
  type ExperimentInput,
  type ExperimentRecord,
  type PrimaryComparison,
} from '@architect/shared';
import { flag, listOption, stringOption, type Parsed, type Values } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { findField, printDoc, type Api } from '../lab';
import { line, table } from '../render';

const USAGE =
  'Usage: architect experiment plan <field> --arms a,b --hypothesis "..." --primary a-b:group [options] | preregister|start|resume|pause|stop|status|report <id> | list';

const usd = (value: number) => `$${value.toFixed(2)}`;

function usage(message: string): CliError {
  return new CliError('invalid_input', 'usage', message);
}

/** A number the person typed, at least `min`, or the default. */
function amount(
  values: Values,
  name: string,
  fallback: number,
  { min = 0, integer = false } = {},
): number {
  const text = stringOption(values, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  if (
    text.trim() === '' ||
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isInteger(value))
  ) {
    throw usage(
      `--${name} takes ${integer ? 'a whole number' : 'a number'} of at least ${min}, not "${text}".`,
    );
  }
  return value;
}

function seedsOf(text: string, name: string): number[] {
  return text.split(',').map((item) => {
    if (!/^-?\d+$/.test(item.trim())) throw usage(`--${name} takes whole numbers, not "${text}".`);
    return Number(item);
  });
}

function armOf(text: string): ArmId {
  const arm = ArmIdSchema.safeParse(text.trim());
  if (!arm.success) {
    throw usage(`"${text}" is not an arm. The arms are ${ArmIdSchema.options.join(', ')}.`);
  }
  return arm.data;
}

/**
 * `a-b:group`: arm a's pass rate less arm b's, on all of the final test, the organizations the
 * arms are taught on (seen) or those they never see (unseen). Arm names hold dashes, so the pair
 * is split where both halves are arms.
 */
function primaryOf(text: string): PrimaryComparison {
  const colon = text.lastIndexOf(':');
  const pair = colon < 0 ? text : text.slice(0, colon);
  const group = ExperimentGroupSchema.safeParse(colon < 0 ? 'all' : text.slice(colon + 1));
  const splits = [...pair.matchAll(/-/g)].flatMap((match) => {
    const a = ArmIdSchema.safeParse(pair.slice(0, match.index));
    const b = ArmIdSchema.safeParse(pair.slice(match.index + 1));
    return a.success && b.success ? [{ a: a.data, b: b.data }] : [];
  });
  const [split] = splits;
  if (!group.success || splits.length !== 1 || split === undefined) {
    throw usage(
      `--primary takes two arms and a part of the final test, such as draft-bare:all (all, seen or unseen), not "${text}".`,
    );
  }
  return { ...split, group: group.data };
}

/** The field a plan is on: a job folder when the argument is one, a field in the library otherwise. */
async function sourceOf(
  ctx: CliContext,
  api: Api,
  named: string | undefined,
): Promise<{ source: { jobId: string } | { jobDir: string }; name: string }> {
  if (named !== undefined && named !== '') {
    const folder = ctx.path(named);
    if (existsSync(folder) && statSync(folder).isDirectory()) {
      return { source: { jobDir: folder }, name: basename(folder) };
    }
  }
  const job = await findField(api, named);
  return { source: { jobId: job.id }, name: job.name };
}

function planText(ctx: CliContext, detail: Awaited<ReturnType<Api['experiments']['plan']>>): void {
  const { experiment: record, projection } = detail;
  const { input } = record;
  const out = ctx.io.stdout;
  line(out, `Planned ${record.input.name} (${record.id}) on ${record.job.name}: ${record.status}.`);
  line(out, `Arms: ${input.arms.map((item) => item.arm).join(', ')}`);
  if (input.hypothesis !== undefined) line(out, `Hypothesis: ${input.hypothesis}`);
  const primary = input.primaryComparison;
  if (primary !== undefined)
    line(out, `Primary: ${primary.a} less ${primary.b}, on ${primary.group}`);
  line(
    out,
    `Caps: student ${usd(input.caps.studentUsd)}, Spark ${usd(input.caps.sparkUsd)}, compute ${usd(input.caps.computeUsd)}, ${input.caps.wallMinutes} minutes`,
  );
  line(
    out,
    `Projected at the prices assumed so far: student ${usd(projection.funded.studentUsd)}, Spark ${usd(projection.funded.sparkUsd)}.`,
  );
  for (const arm of projection.arms.filter((item) => !item.funded)) {
    line(out, `${arm.arm} is not funded: ${arm.reason ?? 'the caps leave no room for it'}`);
  }
  line(out, `Next: architect experiment preregister ${record.id}`);
}

async function plan(
  ctx: CliContext,
  parsed: Parsed,
  named: string | undefined,
): Promise<CliOutcome> {
  const { values } = parsed;
  const armsText = stringOption(values, 'arms');
  if (armsText === undefined) {
    throw usage(`Say which arms to compare with --arms, such as bare,draft. ${USAGE}`);
  }
  const arms = armsText
    .split(',')
    .filter((item) => item.trim() !== '')
    .map(armOf);
  const { api } = await ctx.engine();
  const { source, name } = await sourceOf(ctx, api, named);
  const defaults = defaultExperimentSettings();
  const hypothesis = stringOption(values, 'hypothesis');
  const primary = stringOption(values, 'primary');
  const seeds = stringOption(values, 'seeds');
  const input: ExperimentInput = {
    name: stringOption(values, 'name') ?? name,
    ...source,
    ...(hypothesis === undefined ? {} : { hypothesis }),
    ...(primary === undefined ? {} : { primaryComparison: primaryOf(primary) }),
    arms: arms.map((arm) => ({ arm })),
    seeds: {
      mentoring: seedsOf(stringOption(values, 'mentoring-seed') ?? '1', 'mentoring-seed')[0] ?? 1,
      lockedTest: seeds === undefined ? defaults.seeds.lockedTest : seedsOf(seeds, 'seeds'),
    },
    rounds: amount(values, 'rounds', defaults.rounds, { min: 1, integer: true }),
    caps: {
      studentUsd: amount(values, 'student-usd', defaults.caps.studentUsd),
      sparkUsd: amount(values, 'spark-usd', defaults.caps.sparkUsd),
      computeUsd: amount(values, 'compute-usd', defaults.caps.computeUsd),
      wallMinutes: amount(values, 'wall-minutes', defaults.caps.wallMinutes, { min: 1 }),
    },
  };
  const detail = await api.experiments.plan(input);
  if (flag(values, 'json')) {
    printDoc(ctx.io.stdout, ExperimentPlanDocSchema, { format: EXPERIMENT_PLAN_FORMAT, ...detail });
  } else {
    planText(ctx, detail);
  }
  return 'succeeded';
}

function needId(id: string | undefined): string {
  if (id === undefined || id === '') throw usage(`Name the experiment by its id. ${USAGE}`);
  return id;
}

function say(ctx: CliContext, values: Values, record: ExperimentRecord, text: string): void {
  if (flag(values, 'json')) {
    printDoc(ctx.io.stdout, ExperimentDocSchema, { format: EXPERIMENT_FORMAT, experiment: record });
  } else {
    line(ctx.io.stdout, text);
  }
}

async function preregister(ctx: CliContext, parsed: Parsed, id: string): Promise<CliOutcome> {
  const { api } = await ctx.engine();
  const record = await api.experiments.preregister(id);
  const frozen = record.preregistration;
  say(
    ctx,
    parsed.values,
    record,
    `Preregistered ${record.id} at ${frozen?.at ?? ''}. Its arms, seeds and caps are frozen (sha256 ${frozen?.sha256 ?? ''}).\nNext: architect experiment start ${record.id}`,
  );
  return 'succeeded';
}

async function pause(ctx: CliContext, parsed: Parsed, id: string): Promise<CliOutcome> {
  const { api } = await ctx.engine();
  try {
    const record = await api.experiments.pause(id);
    say(
      ctx,
      parsed.values,
      record,
      `Paused ${record.id}. Go on with: architect experiment resume ${record.id}`,
    );
  } catch (error) {
    if (error instanceof CodedError && error.code === 'experiment_state') {
      throw new CliError(
        'not_permitted',
        error.code,
        error.message,
        'An experiment runs in the terminal that started it; press Ctrl+C there to pause it.',
      );
    }
    throw error;
  }
  return 'succeeded';
}

async function stop(ctx: CliContext, parsed: Parsed, id: string): Promise<CliOutcome> {
  const { api } = await ctx.engine();
  const record = await api.experiments.stop(id);
  say(
    ctx,
    parsed.values,
    record,
    `Stopped ${record.id}. What it measured is kept; it does not start again.`,
  );
  return 'succeeded';
}

const RUNNING = new Set(['running', 'calibrating']);

/**
 * `start` and `resume`: runs the experiment in this process until it ends, the way the app runs
 * it in its engine. Ctrl+C pauses it; resume goes on from there. The exit code says where it
 * ended: 0 finished, 3 waiting for you (Spark's brief to confirm, a plan the caps cut down, or
 * money), 4 paused, stopped or incomplete, 1 failed.
 */
async function run(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
  id: string,
  verb: 'start' | 'resume',
): Promise<CliOutcome> {
  const { values } = parsed;
  const raised = stringOption(values, 'student-cap-usd');
  const dropped = listOption(values, 'drop-arm').map(armOf);
  const options = ExperimentStartSchema.parse({
    ...(flag(values, 'confirm') ? { confirm: true } : {}),
    ...(stringOption(values, 'confirm-study') === undefined
      ? {}
      : { studyToken: stringOption(values, 'confirm-study') }),
    ...(raised === undefined ? {} : { studentCapUsd: amount(values, 'student-cap-usd', 0) }),
    ...(dropped.length === 0 ? {} : { dropArms: dropped }),
  });
  const { api } = await ctx.engine();
  let off = () => {};
  const ended = new Promise<ExperimentRecord>((resolve) => {
    off = api.experiments.onEvent((event) => {
      if (event.experimentId === id && !RUNNING.has(event.experiment.status)) {
        resolve(event.experiment);
      }
    });
  });
  try {
    await api.experiments[verb](id, options);
  } catch (error) {
    off();
    throw error;
  }
  line(ctx.io.stderr, `Running ${id}. Ctrl+C pauses it; resume goes on from there.`);
  const onAbort = () => void api.experiments.pause(id).catch(() => undefined);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  const record = await ended;
  off();
  signal.removeEventListener('abort', onAbort);

  const detail = await api.experiments.get(id);
  if (flag(values, 'json')) {
    printDoc(ctx.io.stdout, ExperimentDocSchema, { format: EXPERIMENT_FORMAT, experiment: record });
  }
  const reason = record.reason === undefined ? '' : ` ${record.reason}`;
  const out = flag(values, 'json') ? ctx.io.stderr : ctx.io.stdout;
  switch (record.status) {
    case 'finished':
      line(out, `Finished ${id}. Read the results with: architect experiment report ${id}`);
      return 'succeeded';
    case 'waiting':
    case 'needs_funding': {
      line(out, `${id} waits for you.${reason}`);
      const token = detail.study !== null && !detail.study.confirmed ? detail.study.token : null;
      line(
        out,
        token === null
          ? `Go on with: architect experiment resume ${id} (--confirm, --student-cap-usd or --drop-arm, as it says)`
          : `Read Spark's brief with: architect experiment status ${id}. Then: architect experiment resume ${id} --confirm-study ${token}`,
      );
      return 'not_permitted';
    }
    case 'failed':
      line(ctx.io.stderr, `${id} failed.${reason}`);
      return 'runtime_error';
    default:
      if (signal.aborted) {
        line(ctx.io.stderr, `Paused ${id}. Go on with: architect experiment resume ${id}`);
        return 'cancelled';
      }
      line(out, `${id} is ${record.status}.${reason}`);
      return 'task_failed';
  }
}

async function list(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const { api } = await ctx.engine();
  const experiments = await api.experiments.list();
  if (flag(parsed.values, 'json')) {
    printDoc(ctx.io.stdout, ExperimentListDocSchema, {
      format: EXPERIMENT_LIST_FORMAT,
      experiments,
    });
  } else if (experiments.length === 0) {
    line(ctx.io.stderr, `No experiments in ${ctx.dataDir}.`);
  } else {
    line(
      ctx.io.stdout,
      table([
        ['ID', 'NAME', 'FIELD', 'STATUS'],
        ...experiments.map((item) => [item.id, item.input.name, item.job.name, item.status]),
      ]),
    );
  }
  return 'succeeded';
}

/**
 * What the API shows before the tests are released, and nothing else: the record, each arm's
 * status and what has been spent. No arm's measurements are in it until the release.
 */
async function status(ctx: CliContext, parsed: Parsed, id: string): Promise<CliOutcome> {
  const { api } = await ctx.engine();
  const detail = await api.experiments.get(id);
  const { experiment: record, report } = detail;
  const arms = (report?.arms ?? []).map(({ arm, label, status: armStatus }) => ({
    arm,
    label,
    status: armStatus,
  }));
  if (flag(parsed.values, 'json')) {
    printDoc(ctx.io.stdout, ExperimentStatusDocSchema, {
      format: EXPERIMENT_STATUS_FORMAT,
      experiment: record,
      released: detail.released,
      funding: detail.funding,
      study: detail.study,
      arms,
      totals: report?.totals ?? null,
    });
    return 'succeeded';
  }
  const out = ctx.io.stdout;
  line(out, `${record.input.name} (${record.id}) on ${record.job.name}: ${record.status}`);
  if (record.reason !== undefined) line(out, record.reason);
  line(
    out,
    record.preregistration === null
      ? 'Not preregistered.'
      : `Preregistered at ${record.preregistration.at}.`,
  );
  line(
    out,
    detail.released ? 'The final tests are released.' : 'The final tests are not released.',
  );
  if (arms.length > 0) {
    line(out);
    line(out, table([['ARM', 'STATUS'], ...arms.map((item) => [item.arm, item.status])]));
  }
  if (report !== null) {
    const { totals } = report;
    line(
      out,
      `Spent: Spark ${usd(totals.sparkUsd)}, student ${totals.studentUsd === null ? 'unknown' : usd(totals.studentUsd)}, compute ${usd(totals.computeUsd)}.`,
    );
  }
  if (detail.study !== null && !detail.study.confirmed) {
    line(out);
    line(out, "Spark's brief of the organizations waits for you:");
    for (const skill of detail.study.brief.skills) line(out, `  ${skill.taskType}: ${skill.text}`);
    line(
      out,
      `Confirm it with: architect experiment resume ${record.id} --confirm-study ${detail.study.token}`,
    );
  }
  return 'succeeded';
}

/**
 * Released results only. Until the runner released the final tests there is no result to show,
 * and the command says so without printing anything from the API's report.
 */
async function report(ctx: CliContext, parsed: Parsed, id: string): Promise<CliOutcome> {
  const { api } = await ctx.engine();
  const detail = await api.experiments.get(id);
  if (!detail.released || detail.report === null) {
    throw new CliError(
      'task_failed',
      'not_released',
      `${id} has no results yet: its final tests are released only after every arm is frozen or ended.`,
      `Check where it stands with: architect experiment status ${id}`,
    );
  }
  if (flag(parsed.values, 'json')) {
    printDoc(ctx.io.stdout, ExperimentReportDocSchema, {
      format: EXPERIMENT_REPORT_FORMAT,
      experimentId: id,
      report: detail.report,
    });
  } else {
    ctx.io.stdout.write(`${renderComparisonMarkdown(detail.report)}\n`);
  }
  return 'succeeded';
}

/**
 * `architect experiment plan | preregister | start | resume | pause | stop | status | report |
 * list` (decision 074, scripted in decision 090): the app's experiments API, one call each.
 * Nothing here reads the final test; a result appears only in the report the runner released.
 */
export async function experiment(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const [action, named] = parsed.args;
  switch (action) {
    case 'plan':
      return plan(ctx, parsed, named);
    case 'list':
      return list(ctx, parsed);
    case 'preregister':
      return preregister(ctx, parsed, needId(named));
    case 'start':
    case 'resume':
      return run(ctx, parsed, signal, needId(named), action);
    case 'pause':
      return pause(ctx, parsed, needId(named));
    case 'stop':
      return stop(ctx, parsed, needId(named));
    case 'status':
      return status(ctx, parsed, needId(named));
    case 'report':
      return report(ctx, parsed, needId(named));
    default:
      throw new CliError(
        'invalid_input',
        'usage',
        `architect experiment has no action called "${action}".`,
        USAGE,
      );
  }
}
