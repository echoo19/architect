import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CodedError,
  ComparisonReportSchema,
  ExperimentInputSchema,
  ExperimentRecordSchema,
  fundingMessage,
  JobSchema,
  newId,
  StudyRecordSchema,
  type ArmId,
  type ComparisonReport,
  type ExperimentDetail,
  type ExperimentEvent,
  type ExperimentInput,
  type ExperimentRecord,
  type ExperimentStart,
  type Job,
} from '@architect/shared';
import { comparisonJob, DEFAULT_MODELS } from '../comparisons/arms';
import { fieldOf } from '../comparisons/field';
import { inputsChanged, pinInputs } from '../comparisons/inputs';
import {
  DEFAULT_CONFIG,
  modelInputs,
  project,
  type ComparisonConfig,
} from '../comparisons/projection';
import { ComparisonFiles } from '../comparisons/records';
import {
  runComparison,
  type ComparisonEnvironment,
  type ComparisonOutcome,
  type ComparisonView,
} from '../comparisons/runner';
import { isStudied, studyToken } from '../drafting/study';
import { STUDY_CAP_USD } from '../drafting/studying';
import { errorMessage } from '../loop/errors';
import type { Clock } from '../loop/deps';
import { isoNow } from '../loop/time';

/** The comparisons runner's environment on one experiment's data folder, and how to close it. */
export interface ExperimentEnvironment {
  env: ComparisonEnvironment;
  close(): Promise<void>;
}

export interface ExperimentServiceOptions {
  /** Where experiments are kept: a folder each, with its record and the runner's output. */
  dir: string;
  clock: Clock;
  /**
   * The runner's environment on a data folder, writing its lines to `log`; absent where
   * experiments can't run.
   */
  environment?: (dataDir: string, log: (line: string) => void) => ExperimentEnvironment;
  /** Failures nobody asked about, such as an environment that didn't close. */
  onError(error: unknown): void;
}

/** A command of the runner going on now, and what its end means when the person ended it. */
interface Active {
  abort: AbortController;
  view: ComparisonView | null;
  ending: { status: 'paused' | 'stopped'; reason?: string } | null;
  done: Promise<void>;
}

const RECORD = 'experiment.json';
const PREREGISTRATION = 'preregistration.json';

/** Statuses it may be started or resumed from, and the ones that end it for good. */
const RESUMABLE = new Set(['paused', 'waiting', 'needs_funding', 'incomplete', 'failed']);
const ENDED = new Set(['finished', 'stopped']);

function readJob(jobDir: string): Job {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(jobDir, 'job.json'), 'utf8'));
  } catch (error) {
    throw new CodedError('not_a_job', `${jobDir} has no readable job.json.`, { cause: error });
  }
  const job = JobSchema.safeParse(raw);
  if (!job.success) throw new CodedError('not_a_job', `${jobDir}/job.json isn't a job.`);
  return job.data;
}

/** Spark's cap for each arm that calls it: the person's where set, the runner's otherwise. */
function sparkCapsOf(input: ExperimentInput): ComparisonConfig['sparkCaps'] {
  const set = (arm: ArmId) => input.arms.find((item) => item.arm === arm)?.sparkUsd;
  const defaults = DEFAULT_CONFIG.sparkCaps;
  return {
    draft: set('draft') ?? defaults.draft,
    targeted: set('targeted') ?? defaults.targeted,
    fixed: set('fixed') ?? defaults.fixed,
    reference: set('reference') ?? defaults.reference,
    referenceTargeted: set('reference-targeted') ?? defaults.referenceTargeted,
    weights: set('weights-one-shot') ?? set('weights-targeted') ?? defaults.weights,
  };
}

/**
 * The runner's settings for an experiment: decision 037's defaults, with the person's arms,
 * seeds, rounds and caps. Nothing runs on this computer's GPU from the app.
 */
export function configOf(input: ExperimentInput): ComparisonConfig {
  return {
    ...DEFAULT_CONFIG,
    arms: input.arms.map((item) => item.arm),
    caps: {
      studentUsd: input.caps.studentUsd,
      sparkUsd: input.caps.sparkUsd,
      computeUsd: input.caps.computeUsd,
      localMinutes: 0,
    },
    sparkCaps: sparkCapsOf(input),
    studentCaps: Object.fromEntries(
      input.arms.flatMap((item) =>
        item.studentUsd === undefined ? [] : [[item.arm, item.studentUsd]],
      ),
    ),
    mentoringSeed: input.seeds.mentoring,
    testSeeds: [...input.seeds.lockedTest],
    rounds: input.rounds,
    realCompute: input.caps.computeUsd > 0,
  };
}

/** What a preregistration's hash covers: the input as stored and the job's pinned files. */
function hashOf(input: ExperimentInput, pinned: unknown): string {
  return createHash('sha256').update(JSON.stringify({ input, pinned })).digest('hex');
}

/**
 * Experiments the app plans, preregisters, runs and reads (decision 074), each through the
 * comparisons runner on a data folder of its own, with the runner's caps, its study confirmed
 * once, and its test-release barrier as they are. Nothing here makes a locked result: the runner
 * does, and `get` shows none before the runner released the tests.
 */
export class ExperimentService {
  private readonly active = new Map<string, Active>();
  private readonly listeners = new Set<(event: ExperimentEvent) => void>();

  constructor(private readonly options: ExperimentServiceOptions) {
    mkdirSync(options.dir, { recursive: true });
    // A command the app closed in the middle of is paused; going on spends, so the person resumes it.
    // The time it ran until then still counts against its wall clock.
    for (const record of this.records()) {
      if (record.status === 'running') {
        const { runningSince, ...rest } = record;
        const ran =
          runningSince === undefined
            ? 0
            : Math.max(0, options.clock.now() - Date.parse(runningSince));
        this.write({
          ...rest,
          status: 'paused',
          reason: 'Architect closed while it ran. Resume it to go on.',
          runningMs: record.runningMs + ran,
        });
      }
      if (record.status === 'calibrating') {
        this.write({
          ...record,
          status: record.preregistration === null ? 'draft' : 'preregistered',
        });
      }
    }
  }

  async plan(input: ExperimentInput): Promise<ExperimentDetail> {
    const parsed = ExperimentInputSchema.parse({ ...input, jobDir: resolve(input.jobDir) });
    const job = readJob(parsed.jobDir);
    const at = isoNow(this.options.clock);
    const record: ExperimentRecord = {
      id: newId('cmp'),
      input: parsed,
      job: { id: job.id, name: job.name, splitsSeed: job.splits.seed },
      status: 'draft',
      preregistration: null,
      calibratedAt: null,
      runningMs: 0,
      createdAt: at,
      updatedAt: at,
    };
    this.write(record);
    return this.detail(record);
  }

  async revise(id: string, input: ExperimentInput): Promise<ExperimentDetail> {
    const record = this.idle(id);
    this.unfrozen(record);
    const parsed = ExperimentInputSchema.parse({ ...input, jobDir: resolve(input.jobDir) });
    if (parsed.jobDir !== record.input.jobDir) {
      throw new CodedError(
        'experiment_state',
        'An experiment stays on the job it was planned on; plan a new one for another job.',
      );
    }
    if (record.status !== 'draft') {
      throw new CodedError('experiment_state', `It is ${record.status}, so its plan can't change.`);
    }
    return this.detail(this.update(id, { input: parsed }));
  }

  async calibrate(id: string): Promise<ExperimentRecord> {
    const record = this.idle(id);
    if (record.status !== 'draft' && record.status !== 'preregistered') {
      throw new CodedError('experiment_state', `It is ${record.status}; calibration comes first.`);
    }
    if (record.preregistration !== null) this.checkFrozen(record);
    return this.launch(record, 'calibrate', {});
  }

  async preregister(id: string): Promise<ExperimentRecord> {
    const record = this.idle(id);
    this.unfrozen(record);
    if (record.status !== 'draft') {
      throw new CodedError(
        'experiment_state',
        `It is ${record.status}, so it can't be preregistered.`,
      );
    }
    const { jobDir } = record.input;
    const pinned = pinInputs(jobDir, readJob(jobDir));
    const preregistration = {
      at: isoNow(this.options.clock),
      sha256: hashOf(record.input, pinned),
      pinned,
    };
    // Kept apart as well, written once: the frozen plan as it was, beside the record.
    writeFileSync(
      join(this.folder(id), PREREGISTRATION),
      `${JSON.stringify({ ...preregistration, input: record.input }, null, 2)}\n`,
      { flag: 'wx' },
    );
    return this.update(id, { status: 'preregistered', preregistration });
  }

  async start(id: string, options: ExperimentStart): Promise<ExperimentRecord> {
    const record = this.idle(id);
    if (record.status !== 'preregistered') {
      throw new CodedError(
        'experiment_state',
        record.preregistration === null
          ? 'Preregister it before it starts: its arms, seeds and caps are frozen first.'
          : `It is ${record.status}; resume it instead.`,
      );
    }
    return this.launch(record, 'run', options);
  }

  async resume(id: string, options: ExperimentStart): Promise<ExperimentRecord> {
    const record = this.idle(id);
    if (!RESUMABLE.has(record.status)) {
      throw new CodedError(
        'experiment_state',
        `It is ${record.status}, so there is nothing to resume.`,
      );
    }
    return this.launch(record, 'run', options);
  }

  async pause(id: string): Promise<ExperimentRecord> {
    const record = this.read(id);
    const active = this.active.get(id);
    if (active === undefined || record.status !== 'running') {
      throw new CodedError('experiment_state', `It is ${record.status}, so it can't be paused.`);
    }
    await this.end(active, { status: 'paused' });
    return this.read(id);
  }

  async stop(id: string): Promise<ExperimentRecord> {
    const record = this.read(id);
    const active = this.active.get(id);
    if (active !== undefined) {
      await this.end(active, { status: 'stopped', reason: 'Stopped by you.' });
      return this.read(id);
    }
    if (ENDED.has(record.status)) return record;
    return this.update(id, { status: 'stopped', reason: 'Stopped by you.' });
  }

  async list(): Promise<ExperimentRecord[]> {
    return this.records().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<ExperimentDetail> {
    return this.detail(this.read(id));
  }

  onEvent(listener: (event: ExperimentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Pauses every command going on, as closing the app does; each resumes when the person asks. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.active.values()].map((active) =>
        this.end(active, {
          status: 'paused',
          reason: 'Architect closed while it ran. Resume it to go on.',
        }),
      ),
    );
  }

  /**
   * Runs the runner once in the background: calibration alone (its `plan`), or the experiment
   * (its `run`) held to the wall clock left. The record says where it stands when it ends.
   */
  private launch(
    record: ExperimentRecord,
    kind: 'calibrate' | 'run',
    options: ExperimentStart,
  ): ExperimentRecord {
    const environment = this.options.environment;
    if (environment === undefined) {
      throw new CodedError('experiment_state', "Experiments can't run in this build.");
    }
    const { id } = record;
    // Raising the cap or dropping an arm answers a pause for money (decision 081), and nothing else.
    const answers = options.studentCapUsd !== undefined || options.dropArms !== undefined;
    if (answers && record.status !== 'needs_funding') {
      throw new CodedError(
        'experiment_state',
        'The student cap can be raised, or an arm dropped, only while it waits for money.',
      );
    }
    const wallLeftMs = record.input.caps.wallMinutes * 60_000 - record.runningMs;
    if (kind === 'run') {
      this.checkFrozen(record);
      if (wallLeftMs <= 0) {
        throw new CodedError('experiment_state', 'Its wall clock cap is used up.');
      }
    }
    const before = record.status;
    const active: Active = {
      abort: new AbortController(),
      view: null,
      ending: null,
      done: Promise.resolve(),
    };
    this.active.set(id, active);
    const started = this.options.clock.now();
    const running = this.update(id, {
      status: kind === 'run' ? 'running' : 'calibrating',
      reason: undefined,
      ...(kind === 'run' ? { runningSince: isoNow(this.options.clock) } : {}),
    });
    if (kind === 'run') {
      this.options.clock.timeout(wallLeftMs).addEventListener('abort', () => {
        if (this.active.get(id) !== active) return;
        void this.end(active, { status: 'stopped', reason: 'Its wall clock cap was reached.' });
      });
    }
    const out = this.out(id);
    active.done = (async () => {
      const stops: (() => void)[] = [];
      let opened: ExperimentEnvironment | null = null;
      let patch: Partial<ExperimentRecord>;
      // The runner's lines go to the experiment's own log, beside its record, which no screen reads.
      const logFile = join(this.folder(id), 'runner.log');
      try {
        opened = environment(join(out, 'data'), (line) =>
          appendFileSync(logFile, `${isoNow(this.options.clock)}  ${line}\n`),
        );
        const { outcome } = await runComparison(
          {
            jobDir: record.input.jobDir,
            out,
            config: configOf(record.input),
            models: DEFAULT_MODELS,
            confirm: options.confirm === true,
            planOnly: kind === 'calibrate',
            ...(options.studyToken === undefined ? {} : { studyToken: options.studyToken }),
            ...(options.studentCapUsd === undefined
              ? {}
              : { studentCapUsd: options.studentCapUsd }),
            ...(options.dropArms === undefined ? {} : { dropArms: options.dropArms }),
          },
          opened.env,
          {
            signal: active.abort.signal,
            onOpen: (view) => {
              active.view = view;
              stops.push(
                view.onEvent((event) => {
                  if (event.type === 'run.updated' || event.type === 'round.updated') {
                    this.emit(this.read(id));
                  }
                }),
              );
            },
          },
        );
        patch =
          kind === 'calibrate'
            ? { status: before, calibratedAt: isoNow(this.options.clock) }
            : this.afterRun(id, outcome);
      } catch (error) {
        // The runner's words can name a sealed organization; they are stored and sent without it.
        appendFileSync(logFile, `${isoNow(this.options.clock)}  ${errorMessage(error)}\n`);
        const reason = redacted(errorMessage(error), record.input.jobDir);
        patch = kind === 'calibrate' ? { status: before, reason } : { status: 'failed', reason };
      }
      for (const stop of stops) stop();
      try {
        await opened?.close();
      } catch (error) {
        this.options.onError(error);
      }
      this.active.delete(id);
      const spent = kind === 'run' ? this.options.clock.now() - started : 0;
      // The person's pause or stop, or the wall clock, says where it ended, whatever the runner said.
      this.update(id, {
        ...(active.ending === null ? patch : { status: active.ending.status }),
        reason: active.ending === null ? patch.reason : active.ending.reason,
        runningMs: this.read(id).runningMs + spent,
        runningSince: undefined,
      });
    })().catch((error: unknown) => this.options.onError(error));
    return running;
  }

  /** Where a run of the runner left the experiment. */
  private afterRun(id: string, outcome: ComparisonOutcome): Partial<ExperimentRecord> {
    switch (outcome) {
      case 'finished':
        return { status: 'finished' };
      case 'needs_funding': {
        const funding = new ComparisonFiles(this.out(id)).readPlan()?.funding ?? null;
        return {
          status: 'needs_funding',
          reason:
            funding === null
              ? 'An arm needs more than the student cap has left.'
              : fundingMessage(funding),
        };
      }
      case 'needs_confirmation':
        return {
          status: 'waiting',
          reason:
            this.study(id)?.confirmed === false
              ? "Read Spark's brief, then confirm it with its token."
              : 'The caps cut the plan down. Confirm to go ahead with the arms that fit.',
        };
      default:
        return { status: 'incomplete' };
    }
  }

  /** Ends a command the way a closed process would, and waits for the runner to let go. */
  private async end(active: Active, ending: NonNullable<Active['ending']>): Promise<void> {
    // A stop wins over a pause still pending; nothing else replaces an ending already asked for.
    if (active.ending === null || ending.status === 'stopped') active.ending = ending;
    active.abort.abort();
    await active.done;
  }

  /** Refuses a run whose frozen plan or job files are not what was preregistered. */
  private checkFrozen(record: ExperimentRecord): void {
    const frozen = record.preregistration;
    if (frozen === null) {
      throw new CodedError('experiment_state', 'Preregister it before it starts.');
    }
    if (hashOf(record.input, frozen.pinned) !== frozen.sha256) {
      throw new CodedError(
        'experiment_frozen',
        "Its plan isn't the one preregistered, so it doesn't run.",
      );
    }
    const { jobDir } = record.input;
    const changed = inputsChanged(frozen.pinned, pinInputs(jobDir, readJob(jobDir)), true);
    if (changed !== null) {
      throw new CodedError(
        'experiment_frozen',
        `The job changed since it was preregistered: ${changed}. Plan a new experiment on the job as it is now.`,
      );
    }
  }

  private async detail(record: ExperimentRecord): Promise<ExperimentDetail> {
    const { input } = record;
    const files = new ComparisonFiles(this.out(record.id));
    const source = readJob(input.jobDir);
    const field = fieldOf(input.jobDir, source);
    const config = {
      ...configOf(input),
      lockedTests: field.lockedTests,
      certifyAttempts: field.certifyAttempts,
    };
    const base = comparisonJob(source, config, DEFAULT_MODELS);
    const plan = files.readPlan();
    const calibration = files.readSweep('calibration');
    const study = this.study(record.id);
    const assumed = modelInputs(base, config, [], { attempts: [], reading: null });
    // Once the runner confirmed its plan it holds the arms to that projection; before, the
    // projection follows the plan as it stands, at calibration's prices once they are measured.
    const projection =
      plan !== null && plan.confirmedAt !== null
        ? plan.projection
        : project(
            base,
            config,
            modelInputs(base, config, calibration, { attempts: [], reading: null }),
            calibration.reduce((sum, attempt) => sum + (attempt.usd ?? 0), 0),
            study?.costUsd ?? 0,
          );
    const released = (plan?.releasedAt ?? null) !== null;
    return {
      experiment: record,
      projection,
      calibration: {
        tasks: base.splits.calibration,
        studentUsdEstimate: base.splits.calibration * assumed.studentUsd.value,
        studentUsdCap: input.caps.studentUsd,
        studySparkUsdCap: isStudied(base) ? Math.min(STUDY_CAP_USD, input.caps.sparkUsd) : null,
      },
      study:
        study === null
          ? null
          : { brief: study.brief, token: study.token, confirmed: study.confirmed },
      released,
      funding: plan?.funding ?? null,
      amendments: plan?.amendments ?? [],
      report: withheld(await this.report(record.id, files), released, sealedNames(source)),
    };
  }

  /** The runner's report: from its records while it runs, as it last wrote it otherwise. */
  private async report(id: string, files: ComparisonFiles): Promise<ComparisonReport | null> {
    const view = this.active.get(id)?.view;
    if (view !== undefined && view !== null) return view.report();
    if (!existsSync(files.reportJson)) return null;
    return ComparisonReportSchema.parse(JSON.parse(readFileSync(files.reportJson, 'utf8')));
  }

  /** Spark's brief as the runner kept it in the experiment's folder, with its token. */
  private study(id: string) {
    const file = new ComparisonFiles(this.out(id)).study;
    if (!existsSync(file)) return null;
    const record = StudyRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    return {
      brief: record.brief,
      token: studyToken(record),
      confirmed: record.confirmedAt !== undefined,
      costUsd: record.cost.usd,
    };
  }

  private emit(record: ExperimentRecord): void {
    const event: ExperimentEvent = {
      type: 'experiment.updated',
      experimentId: record.id,
      at: isoNow(this.options.clock),
      experiment: record,
    };
    for (const listener of this.listeners) listener(event);
  }

  /** The record, when nothing is running on it. */
  private idle(id: string): ExperimentRecord {
    const record = this.read(id);
    if (this.active.has(id)) {
      throw new CodedError('experiment_state', `It is ${record.status}; wait for that to end.`);
    }
    return record;
  }

  private unfrozen(record: ExperimentRecord): void {
    if (record.preregistration !== null) {
      throw new CodedError(
        'experiment_frozen',
        `It was preregistered at ${record.preregistration.at}; its arms, seeds and caps can't change.`,
      );
    }
  }

  private folder(id: string): string {
    return join(this.options.dir, id);
  }

  private out(id: string): string {
    return join(this.folder(id), 'comparison');
  }

  private read(id: string): ExperimentRecord {
    const file = join(this.folder(id), RECORD);
    if (!/^cmp_[a-z0-9]+$/.test(id) || !existsSync(file)) {
      throw new CodedError('experiment_not_found', `There is no experiment "${id}".`);
    }
    return ExperimentRecordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  }

  private records(): ExperimentRecord[] {
    return readdirSync(this.options.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(this.folder(entry.name), RECORD)))
      .map((entry) => this.read(entry.name));
  }

  private write(record: ExperimentRecord): void {
    mkdirSync(this.folder(record.id), { recursive: true });
    writeFileSync(
      join(this.folder(record.id), RECORD),
      `${JSON.stringify(ExperimentRecordSchema.parse(record), null, 2)}\n`,
    );
  }

  private update(id: string, patch: Partial<ExperimentRecord>): ExperimentRecord {
    const next = { ...this.read(id), ...patch, updatedAt: isoNow(this.options.clock) };
    if (next.reason === undefined) delete next.reason;
    if (next.runningSince === undefined) delete next.runningSince;
    this.write(next);
    this.emit(next);
    return next;
  }
}

/**
 * A message with every sealed organization's id and name taken out, for a failure stored on the
 * record and sent to screens before the release.
 */
function redacted(message: string, jobDir: string): string {
  let job: Job;
  try {
    job = readJob(jobDir);
  } catch {
    // Without the job file nothing says what is sealed, so nothing of the message is kept.
    return 'The comparison stopped with an error; its log says what.';
  }
  const sealed = (job.organizations ?? []).filter((org) => org.role === 'transfer');
  let text = message;
  for (const org of sealed) {
    text = text.split(org.name).join('a sealed organization');
    text = text.replace(new RegExp(`\\b${escaped(org.id)}\\b`, 'g'), 'a sealed organization');
  }
  return text;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The names of the organizations no arm trains on, which stay sealed until the release. */
function sealedNames(job: Job): string[] {
  return (job.organizations ?? []).filter((org) => org.role === 'transfer').map((org) => org.name);
}

/**
 * The report with nothing of the sealed test before the runner released it (invariant 1): no
 * locked result, which it holds none of then, and no sentence naming a sealed organization.
 */
function withheld(
  report: ComparisonReport | null,
  released: boolean,
  sealed: readonly string[],
): ComparisonReport | null {
  if (report === null || released) return report;
  return {
    ...report,
    backends: [],
    arms: report.arms.map((arm) => ({ ...arm, measuredOn: [] })),
    plan: {
      ...report.plan,
      seedResults: report.plan.seedResults.map((seed) => ({ ...seed, arms: [] })),
    },
    disclosures: report.disclosures.filter((line) => !sealed.some((name) => line.includes(name))),
  };
}
