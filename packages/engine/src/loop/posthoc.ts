import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ATTEMPT_TOKENS,
  CodedError,
  CertifyRequestSchema,
  costUsd,
  newId,
  SECONDS_PER_ATTEMPT,
  STUDENT_PRESETS,
  studentPricing,
  type Certification,
  type CertificationCheckPlan,
  type CertifyRequest,
  type Job,
  type StudentTarget,
  type Task,
} from '@architect/shared';
import { agreementSeeds, normalizedReply } from '../certify/agreement';
import { trainOrganizations } from '../drafting/study';
import { splitTasks } from '../splits/split';
import type { EngineStore } from '../store/engine-store';
import type { StoredCertification, StoredRun } from '../store/records';
import type { CertificationSets } from '../vault/vault';
import { byTask, certificateOf, scoreTask } from './certify';
import { configurationKey } from './configuration';
import type { Clock, EngineHostDeps, MentorReleased } from './deps';
import { errorMessage, isAbort, must } from './errors';
import { evaluate } from './evaluation';
import { frozenConfig, openLockedTest } from './graduation';
import type { JobLibrary } from './jobs';
import { orgDataDir } from './organizations';
import type { DataPaths } from './paths';
import { RunState, type SessionContext, type SessionControl } from './run-state';
import { deriveSeed } from './seeds';
import { studentEndpoint } from './setup';
import { isoNow } from './time';

/*
 * Certifying a frozen version after the fact (decision 079): calibration tasks drawn from a job's
 * taught organizations that the version's own run, and every run it was improved from, never saw
 * or was tested on, sealed in the vault with the check tasks, then k attempts at each by the
 * frozen version with no mentor. The certificate is the version's evidence and never changes.
 */

export interface CertifyContext {
  store: EngineStore;
  paths: DataPaths;
  jobs: JobLibrary;
  deps: EngineHostDeps;
  clock: Clock;
}

/** A family's name with case, spacing and punctuation set aside: "Invoice 12" is "invoice-12". */
export function familyKey(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** What a version's runs saw, by task id, by family and by a request's words. */
export interface Seen {
  ids: Set<string>;
  families: Set<string>;
  prompts: Set<string>;
}

function emptySeen(): Seen {
  return { ids: new Set(), families: new Set(), prompts: new Set() };
}

function addSeen(seen: Seen, tasks: readonly Task[]): void {
  for (const task of tasks) {
    seen.ids.add(task.id);
    seen.families.add(familyKey(task.family));
    seen.prompts.add(normalizedReply(task.prompt));
  }
}

function isSeen(seen: Seen, task: Task): boolean {
  return (
    seen.ids.has(task.id) ||
    seen.families.has(familyKey(task.family)) ||
    seen.prompts.has(normalizedReply(task.prompt))
  );
}

/**
 * The tasks none of whose family was seen: a family with any task seen by id, by its family's
 * name however written, or by its request's words, is left out whole.
 */
export function freshTasks(pool: readonly Task[], seen: Seen): Task[] {
  const touched = new Set(
    pool.filter((task) => isSeen(seen, task)).map((task) => familyKey(task.family)),
  );
  return pool.filter((task) => !touched.has(familyKey(task.family)));
}

/**
 * The runs whose work shaped a version: the one that made it and, for an improvement, the runs
 * of the versions it improved, back to the first.
 */
function lineageRuns(store: EngineStore, record: StoredRun): StoredRun[] {
  const runs = [record];
  let improves = record.improves;
  while (improves !== undefined) {
    const parent = store.versions.get(improves.graduateId, improves.version);
    const parentRun = parent?.runId === undefined ? null : store.runs.get(parent.runId);
    if (parentRun === null || runs.some((run) => run.run.id === parentRun.run.id)) break;
    runs.push(parentRun);
    improves = parentRun.improves;
  }
  return runs;
}

/**
 * Every task the runs saw or were tested on: each job's train, dev and calibration tasks, its
 * locked test and sealed calibration split, and every task any of the runs attempted.
 */
async function seenBy(
  ctx: CertifyContext,
  runs: readonly StoredRun[],
  proof: MentorReleased,
): Promise<Seen> {
  const seen = emptySeen();
  const { jobs, deps, store } = ctx;
  for (const jobId of new Set(runs.map((record) => record.run.jobId))) {
    addSeen(seen, await visibleTasks(jobs, jobId));
    if (await deps.vault.isSealed(jobId)) {
      addSeen(seen, await deps.vault.openForLockedTest(jobId, proof));
      addSeen(seen, await deps.vault.openCalibration(jobId, proof));
    }
  }
  for (const record of runs) {
    for (const attempt of store.attempts.list({ runId: record.run.id }))
      seen.ids.add(attempt.taskId);
  }
  return seen;
}

async function visibleTasks(jobs: JobLibrary, jobId: string): Promise<Task[]> {
  const splits = await Promise.all([
    jobs.tasks(jobId, 'calibration'),
    jobs.tasks(jobId, 'train'),
    jobs.tasks(jobId, 'dev'),
  ]);
  return splits.flat();
}

/** The job with a hosted student preset as its hosted endpoint, for a certification on it. */
export function withStudent(job: Job, preset: string | undefined): Job {
  if (preset === undefined) return job;
  const found = STUDENT_PRESETS.find((candidate) => candidate.key === preset);
  if (!found || found.runtime !== 'openai_compatible') {
    throw new Error(
      `"${preset}" is not a hosted student. Name one of ${STUDENT_PRESETS.filter(
        (item) => item.runtime === 'openai_compatible',
      )
        .map((item) => item.key)
        .join(', ')}.`,
    );
  }
  return {
    ...job,
    student: {
      ...job.student,
      hosted: {
        runtime: found.runtime,
        baseUrl: found.baseUrl,
        model: found.model,
        ...(found.secretRef === undefined ? {} : { secretRef: found.secretRef }),
        contextLength: job.student.local.contextLength,
      },
    },
  };
}

/** Tasks as one text, in the order given, for a hash of what was sealed. */
function tasksSha256(tasks: readonly Task[]): string {
  return createHash('sha256')
    .update(tasks.map((task) => JSON.stringify(task)).join('\n'))
    .digest('hex');
}

/** The job's declared data files in one folder, hashed: a job without organizations has one. */
async function dataSha256(job: Job, folder: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...job.data.files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const content = await readFile(join(folder, file.name)).catch(() => null);
    hash.update(`${file.name}\n`);
    hash.update(content ?? 'absent');
    hash.update('\n');
  }
  return hash.digest('hex');
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Plans a certification: checks the version can be certified, draws its calibration tasks and
 * its check tasks, seals them, and projects the attempts, the cost and the time. Nothing spends.
 * A request it can't meet is refused with the reason, and nothing is kept.
 */
export async function planCertification(
  ctx: CertifyContext,
  raw: CertifyRequest,
): Promise<StoredCertification> {
  const request = CertifyRequestSchema.parse(raw);
  const { store, jobs, deps, paths } = ctx;
  const named = `version ${request.version}`;
  const version = store.versions.get(request.graduateId, request.version);
  if (version === null) {
    throw new CodedError('agent_not_found', `There is no ${named} of this agent.`);
  }
  const record = version.runId === undefined ? null : store.runs.get(version.runId);
  if (record === null) {
    throw new Error(
      `${capital(named)} was installed, not trained here, so the tasks its run saw aren't known and none can be shown new to it.`,
    );
  }
  const frozen = record.freeze;
  if (frozen === null || record.run.status !== 'finished') {
    throw new Error(`${capital(named)}'s run hasn't finished, so there is no frozen version.`);
  }
  const target: StudentTarget = request.student === undefined ? 'local' : 'hosted';
  if (target === 'hosted' && (frozen.configuration?.adapter ?? null) !== null) {
    throw new Error(
      `${capital(named)} carries trained weights, which run only on this computer's base model; certify it here, without --student.`,
    );
  }
  const runJob = withStudent(await jobs.forRun(record), request.student);
  const source = await jobs.get(request.jobId);
  const taught = trainOrganizations(source);
  if (taught.length === 0) {
    const same =
      (await dataSha256(source, paths.dataDir(source.id))) ===
      (await dataSha256(runJob, paths.dataDir(runJob.id)));
    if (!same) {
      throw new Error(
        `"${source.name}" works on other files than the job ${named} was taught on, so its tasks aren't requests like the ones it learned.`,
      );
    }
  }

  const proof = await deps.runtime.releaseMentor({
    jobId: record.run.jobId,
    runId: record.run.id,
    mentor: null,
  });
  const seen = await seenBy(ctx, lineageRuns(store, record), proof);
  const taughtIds = new Set(taught.map((org) => org.id));
  const pool = (await visibleTasks(jobs, source.id)).filter((task) =>
    taught.length === 0
      ? task.org === undefined
      : task.org !== undefined && taughtIds.has(task.org),
  );
  const fresh = freshTasks(pool, seen);
  if (fresh.length < request.size) {
    throw new Error(
      `Only ${count(fresh.length, 'task')} of "${source.name}"'s taught organizations ${fresh.length === 1 ? 'is' : 'are'} new to ${named}: its run saw or was tested on the rest, or on tasks of the same family. Ask for ${fresh.length} or fewer, or add tasks to the job.`,
    );
  }
  const seq = Math.max(0, ...store.certifications.ofRun(record.run.id).map((item) => item.seq)) + 1;
  let calibration: Task[];
  try {
    calibration = splitTasks(fresh, {
      seed: deriveSeed(record.seeds.test, `certify-${seq}`),
      calibration: 0,
      train: 0,
      dev: 0,
      test: 0,
      certify: request.size,
    }).certify;
  } catch (error) {
    throw new Error(
      `${request.size} calibration tasks can't be drawn with each family kept whole: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const drawn = new Set(calibration.map((task) => task.id));
  const sealedOrgs = (await deps.vault.isSealed(source.id))
    ? (await deps.vault.openTransfer(source.id, proof)).organizations
    : [];
  const sealedTasks =
    sealedOrgs.length > 0 ? await deps.vault.openForLockedTest(source.id, proof) : [];
  const checks: Record<string, Task[]> = {};
  const checkPlans: CertificationCheckPlan[] = [];
  for (const orgId of [...new Set(request.check)]) {
    const own = taught.find((org) => org.id === orgId);
    const sealed = sealedOrgs.find((org) => org.id === orgId);
    const org = own ?? sealed;
    if (org === undefined) {
      throw new Error(`"${source.name}" has no organization "${orgId}".`);
    }
    const tasks =
      own === undefined
        ? freshTasks(
            sealedTasks.filter((task) => task.org === orgId),
            seen,
          )
        : fresh.filter((task) => task.org === orgId && !drawn.has(task.id));
    if (tasks.length === 0) {
      throw new Error(
        own === undefined
          ? `${capital(named)}'s run was already tested on ${org.name}, so a check there wouldn't be on requests it never saw.`
          : `No task at ${org.name} is left for a check once the calibration tasks are drawn. Ask for fewer calibration tasks.`,
      );
    }
    checks[orgId] = tasks;
    checkPlans.push({
      org: orgId,
      orgName: org.name,
      seen: own !== undefined,
      synthetic: org.synthetic,
      tasks: tasks.length,
    });
  }

  const attempts = request.k * (calibration.length + checkPlans.reduce((n, c) => n + c.tasks, 0));
  const endpoint = studentEndpoint(runJob, target);
  const pricing = studentPricing(endpoint);
  if (pricing === undefined) {
    throw new Error(
      `${endpoint.model} has no known price, so the certification couldn't be held to a spending cap.`,
    );
  }
  const projected = attempts * costUsd(pricing, ATTEMPT_TOKENS);
  const seconds = attempts * SECONDS_PER_ATTEMPT[target];
  if (projected > request.maxUsd + 1e-9) {
    throw new CodedError(
      'guard_budget',
      `It would cost about ${usd(projected)} for ${count(attempts, 'attempt')}, more than the ${usd(request.maxUsd)} cap. Raise the cap, or ask for fewer tasks or attempts.`,
    );
  }
  if (seconds > request.maxMinutes * 60) {
    throw new CodedError(
      'guard_budget',
      `It would take about ${Math.ceil(seconds / 60)} minutes for ${count(attempts, 'attempt')}, more than the ${request.maxMinutes}-minute cap. Raise the cap, or ask for fewer tasks or attempts.`,
    );
  }

  // A newer plan replaces one that never started.
  for (const planned of store.certifications.list(request.graduateId, request.version)) {
    if (planned.status !== 'planned') continue;
    await deps.vault.discardCertification(planned.jobId, planned.id);
    store.certifications.remove(planned.id);
  }
  const id = newId('crt');
  const sets: CertificationSets = { calibration, checks };
  const sealedSha256 = await deps.vault.sealCertification(record.run.jobId, id, sets);
  const stored: StoredCertification = {
    id,
    graduateId: request.graduateId,
    version: request.version,
    runId: record.run.id,
    jobId: record.run.jobId,
    seq,
    request,
    plan: {
      jobName: source.name,
      target,
      student: target === 'local' ? frozen.student.model : endpoint.model,
      calibration: calibration.length,
      checks: checkPlans,
      attempts,
      usd: projected,
      seconds,
    },
    inputs: {
      sealedSha256,
      calibrationSha256: tasksSha256(calibration),
      checksSha256: Object.fromEntries(
        Object.entries(checks).map(([org, tasks]) => [org, tasksSha256(tasks)]),
      ),
      harnessHash: frozen.harnessHash,
      adapterSha256: frozen.configuration?.adapter?.sha256 ?? null,
      seeds: agreementSeeds(frozen.testSeeds?.[0] ?? record.seeds.test, request.k),
    },
    status: 'planned',
    activeMs: 0,
    createdAt: isoNow(ctx.clock),
  };
  store.certifications.insert(stored);
  return stored;
}

function capital(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Takes back a planned certification that never started, with its sealed tasks. */
export async function discardCertification(ctx: CertifyContext, id: string): Promise<void> {
  const stored = ctx.store.certifications.get(id);
  if (stored === null) return;
  if (stored.status !== 'planned') {
    throw new Error('Only a certification that never started can be taken back.');
  }
  await ctx.deps.vault.discardCertification(stored.jobId, stored.id);
  ctx.store.certifications.remove(id);
}

/** A certification's attempts so far: the run's, under split `certify` and its own round. */
function attemptsOf(store: EngineStore, stored: StoredCertification) {
  return store.attempts.list({ runId: stored.runId, split: 'certify', round: stored.seq });
}

/** What its attempts have been charged so far. */
function spentOn(store: EngineStore, stored: StoredCertification): number {
  const ids = new Set(attemptsOf(store, stored).map((attempt) => attempt.id));
  return store.costs
    .list(stored.runId)
    .filter(
      (cost) => cost.attemptId !== undefined && cost.attemptId !== null && ids.has(cost.attemptId),
    )
    .reduce((sum, cost) => sum + (cost.usd ?? 0), 0);
}

/** A stored certification as the app shows it, with its progress and spend so far. */
export function certificationView(store: EngineStore, stored: StoredCertification): Certification {
  const { jobId: _jobId, seq: _seq, activeMs: _activeMs, ...shown } = stored;
  return {
    ...shown,
    done: attemptsOf(store, stored).length,
    spentUsd: spentOn(store, stored),
  };
}

/**
 * The certification's attempts and its certificate. Opens the sealed tasks only after checking
 * that what runs is the frozen version (its harness hash, its adapter, the pinned local build)
 * on a released proof, with no mentor ever made. Each attempt starts only within both caps; a
 * cap halts it with the reason, and asking again resumes it.
 */
async function certifyVersion(state: RunState, id: string): Promise<string | null> {
  const { store, deps, clock, paths } = state.ctx;
  const stored = must(store.certifications.get(id), 'The certification');
  const frozen = must(state.record.freeze, 'The frozen version');
  const { target } = stored.plan;
  await openLockedTest(state, frozen, target);
  const proof = await state.resources.releaseMentor();
  const sets = await deps.vault.openCertification(
    stored.jobId,
    stored.id,
    stored.inputs.sealedSha256,
    proof,
  );
  const source = await state.ctx.jobs.get(stored.request.jobId);
  const sealedData: Record<string, string> = {
    ...Object.fromEntries(
      trainOrganizations(source).map((org) => [
        org.id,
        orgDataDir(paths.jobDir(source.id), org.id),
      ]),
    ),
    ...(stored.plan.checks.some((check) => !check.seen)
      ? (await deps.vault.openTransfer(source.id, proof)).dataDirs
      : {}),
  };
  state.log(
    'info',
    `Certifying version ${stored.version} on ${count(stored.plan.calibration, 'task')} its run never saw, ${count(stored.request.k, 'attempt')} each, with no mentor.`,
  );

  const perAttempt = stored.plan.usd / stored.plan.attempts;
  const { maxUsd, maxMinutes } = stored.request;
  let mark = clock.now();
  let halted: string | null = null;
  const mayAttempt = (): boolean => {
    const now = clock.now();
    const current = must(store.certifications.get(id), 'The certification');
    const activeMs = current.activeMs + (now - mark);
    mark = now;
    store.certifications.update({ ...current, activeMs });
    if (spentOn(store, current) + perAttempt > maxUsd + 1e-9) {
      halted = `It reached its ${usd(maxUsd)} cap before every attempt was made.`;
    } else if (activeMs >= maxMinutes * 60_000) {
      halted = `It reached its ${maxMinutes}-minute cap before every attempt was made.`;
    }
    return halted === null;
  };
  const config = frozenConfig(frozen);
  const { seeds } = stored.inputs;
  const checkTasks = stored.plan.checks.flatMap((check) => sets.checks[check.org] ?? []);
  const finished = await evaluate(state, {
    tasks: [...sets.calibration, ...checkTasks],
    split: 'certify',
    round: stored.seq,
    version: frozen.harnessVersion,
    seeds,
    target,
    purpose: 'retest',
    concurrency: 1,
    config,
    ...(frozen.configuration === undefined ? {} : { decoding: frozen.configuration.decoding }),
    sealedData,
    mayAttempt,
  });
  if (!finished) return halted;

  const attempts = byTask(
    state.attempts({
      split: 'certify',
      round: stored.seq,
      version: frozen.harnessVersion,
      target,
      config: configurationKey(config),
    }),
  );
  const score = (task: Task) => scoreTask(attempts.get(task.id) ?? [], seeds);
  const { k, epsilon, delta } = stored.request;
  const certificate = certificateOf(
    { k, epsilon, delta },
    sets.calibration.map(score),
    stored.plan.checks.map(({ org, orgName, seen, synthetic }) => ({
      org,
      orgName,
      seen,
      synthetic,
      scored: (sets.checks[org] ?? []).map(score),
    })),
  );
  const current = must(store.certifications.get(id), 'The certification');
  store.certifications.update({
    ...current,
    status: 'finished',
    activeMs: current.activeMs + (clock.now() - mark),
    certificate,
    endedAt: isoNow(clock),
  });
  state.log(
    'info',
    certificate.issued
      ? `Version ${stored.version} certified: answering when ${certificate.threshold.votes} of ${k} attempts agree, wrong on at most ${(certificate.threshold.bound * 100).toFixed(1)}% with ${Math.round((1 - delta) * 100)}% confidence.`
      : `Version ${stored.version} not certified (${certificate.reason}).`,
  );
  return null;
}

/**
 * One stretch of a certification, from being queued or recovered until its certificate is filed
 * or a cap or an error pauses it. Like a re-test, it never writes to the run, and its attempts
 * leave the run's totals as they were.
 */
export class CertifySession {
  private readonly control: SessionControl = {
    pauseRequested: false,
    abort: new AbortController(),
  };

  constructor(
    private readonly ctx: SessionContext,
    private readonly certificationId: string,
  ) {}

  /** Stops at once, for app shutdown. The certification stays resumable. */
  abort(): void {
    this.control.abort.abort();
  }

  async run(): Promise<void> {
    const { store, runId, jobs } = this.ctx;
    const record = store.runs.get(runId);
    const stored = store.certifications.get(this.certificationId);
    if (!record || stored?.status !== 'certifying') return;
    let state: RunState | undefined;
    try {
      const job = withStudent(await jobs.forWork(record), stored.request.student);
      state = new RunState(this.ctx, this.control, job);
      const halted = await certifyVersion(state, this.certificationId);
      if (halted !== null) this.pause(halted);
    } catch (error) {
      if (this.control.abort.signal.aborted || isAbort(error)) return;
      this.pause(`${errorMessage(error)} Ask for it again once that's fixed.`);
    } finally {
      await state?.resources.close();
    }
  }

  private pause(message: string): void {
    const { store, runId, clock, emit } = this.ctx;
    const stored = must(store.certifications.get(this.certificationId), 'The certification');
    store.certifications.update({ ...stored, status: 'paused', error: message });
    emit({
      type: 'log',
      runId,
      at: isoNow(clock),
      level: 'error',
      message: `The certification of version ${stored.version} paused: ${message}`,
    });
  }
}
