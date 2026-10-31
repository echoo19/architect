import type { DatabaseSync } from 'node:sqlite';
import {
  CategorySchema,
  CorrectionSchema,
  CounterexampleSchema,
  DEFAULT_CONFIG_KEY,
  ExperimentSchema,
  InterventionSchema,
  LessonSchema,
  ReferenceRecordSchema,
  ReportCardSchema,
  RuntimeMeasurementSchema,
  StudentTargetSchema,
  WorkspaceChatSchema,
  WorkspaceMessageSchema,
  type Category,
  type Correction,
  type Counterexample,
  type CorrectionStatus,
  type Experiment,
  type Intervention,
  type Lesson,
  type ReferenceRecord,
  type ReportCard,
  type RunStatus,
  type RuntimeMeasurement,
  type SplitName,
  type StudentTarget,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import { inTransaction, openDatabase, type Migration } from './database';
import { MIGRATIONS } from './migrations';
import {
  CostEntrySchema,
  GraduateRecordSchema,
  JobRecordSchema,
  LineageIndexSchema,
  StoredAttemptSchema,
  StoredCertificationSchema,
  StoredChecksSchema,
  StoredContractSchema,
  StoredInstallationSchema,
  StoredPublicationSchema,
  StoredRepeatSchema,
  StoredQualificationSchema,
  StoredRetestSchema,
  StoredRoundSchema,
  StoredRunSchema,
  StoredVersionEventSchema,
  StoredVersionSchema,
  type CostEntry,
  type GraduateRecord,
  type JobRecord,
  type LineageIndex,
  type RetestStatus,
  type StoredAttempt,
  type StoredCertification,
  type StoredChecks,
  type StoredContract,
  type StoredInstallation,
  type StoredPublication,
  type StoredRepeat,
  type StoredQualification,
  type StoredRetest,
  type StoredRound,
  type StoredRun,
  type StoredVersion,
  type StoredVersionEvent,
} from './records';
import {
  flag,
  fromJson,
  inList,
  json,
  jsonOrNull,
  orUndefined,
  Statements,
  type Params,
  type Row,
} from './sql';

export interface AttemptFilter {
  runId: string;
  split?: SplitName;
  version?: number;
  /** A round number, or null for attempts outside rounds (baseline dev, locked test). */
  round?: number | null;
  target?: StudentTarget;
  /** Who attempted and how; see `StoredAttempt.config`. */
  config?: string;
}

export interface LessonFilter {
  runId?: string;
  jobId?: string;
  round?: number;
  status?: Lesson['status'];
}

/** Everything the engine persists. SQLite sits behind this so it can be swapped (decision 013). */
export interface EngineStore {
  /** Runs `fn` atomically. `fn` must be synchronous. */
  transaction<T>(fn: () => T): T;
  close(): void;
  jobs: {
    insert(job: JobRecord): void;
    update(job: JobRecord): void;
    get(id: string): JobRecord | null;
    list(): JobRecord[];
  };
  runs: {
    insert(record: StoredRun): void;
    update(record: StoredRun): void;
    get(id: string): StoredRun | null;
    /** Newest first. */
    list(jobId?: string): StoredRun[];
    /** Oldest first, so interrupted runs resume in the order they started. */
    withStatus(statuses: readonly RunStatus[]): StoredRun[];
  };
  rounds: {
    insert(record: StoredRound): void;
    update(record: StoredRound): void;
    get(runId: string, index: number): StoredRound | null;
    list(runId: string): StoredRound[];
  };
  attempts: {
    insert(attempt: StoredAttempt): void;
    get(id: string): StoredAttempt | null;
    /** Oldest first. */
    list(filter: AttemptFilter): StoredAttempt[];
    /** Newest first. */
    recent(runId: string, splits: readonly SplitName[], limit: number): StoredAttempt[];
  };
  lineage: {
    insert(row: LineageIndex): void;
    list(runId: string): LineageIndex[];
  };
  costs: {
    insert(entry: CostEntry): void;
    list(runId: string): CostEntry[];
  };
  /** One report card per run and student endpoint its graduate was tested on. */
  reports: {
    /** Files the card under its own run and `testedOn`, replacing any card already there. */
    put(card: ReportCard): void;
    get(runId: string, target: StudentTarget): ReportCard | null;
    /** The endpoints the run has a card from, oldest card first. */
    targets(runId: string): StudentTarget[];
  };
  retests: {
    /** Fails if the run already has a re-test on that target. */
    insert(retest: StoredRetest): void;
    update(retest: StoredRetest): void;
    get(runId: string, target: StudentTarget): StoredRetest | null;
    /** Oldest first, so interrupted re-tests resume in the order they started. */
    withStatus(status: RetestStatus): StoredRetest[];
  };
  /** Frozen versions tested on organizations added to their field later (decision 085). */
  qualifications: {
    /** Fails if the run already has one at that organization. */
    insert(qualification: StoredQualification): void;
    update(qualification: StoredQualification): void;
    get(runId: string, orgId: string): StoredQualification | null;
    /** A run's, oldest first. */
    list(runId: string): StoredQualification[];
    withStatus(status: StoredQualification['status']): StoredQualification[];
  };
  /** Locked tests taken again under the declared seeds a run deferred (decision 045). */
  repeats: {
    /** Fails if the run already has a repeat on that target. */
    insert(repeat: StoredRepeat): void;
    update(repeat: StoredRepeat): void;
    get(runId: string, target: StudentTarget): StoredRepeat | null;
    /** Oldest first, so interrupted repeats resume in the order they started. */
    withStatus(status: StoredRepeat['status']): StoredRepeat[];
  };
  /** What the runtime held during each stretch of an evaluation a meter watched. */
  runtimeMeasurements: {
    insert(measurement: RuntimeMeasurement): void;
    /** Oldest first. */
    list(runId: string): RuntimeMeasurement[];
  };
  graduates: {
    insert(record: GraduateRecord): void;
    update(record: GraduateRecord): void;
    get(id: string): GraduateRecord | null;
    forRun(runId: string): GraduateRecord | null;
    /** Newest first. */
    list(): GraduateRecord[];
    /** Removes the agent with its versions, installation and chats. */
    remove(id: string): void;
  };
  /** Each agent's immutable versions. */
  versions: {
    insert(version: StoredVersion): void;
    /** Only a version's state and acceptance change; its folder and manifest never do. */
    update(version: StoredVersion): void;
    get(graduateId: string, version: number): StoredVersion | null;
    /** Oldest first. */
    list(graduateId: string): StoredVersion[];
    /** The version a run made, if any. */
    forRun(runId: string): StoredVersion | null;
    /** The version whose `graduate.json` has this digest, made here or imported, if any. */
    withDigest(digest: string): StoredVersion | null;
  };
  versionEvents: {
    insert(event: StoredVersionEvent): void;
    /** Oldest first. */
    list(graduateId: string): StoredVersionEvent[];
  };
  installations: {
    /** Inserts or replaces the agent's installation. */
    put(installation: StoredInstallation): void;
    get(graduateId: string): StoredInstallation | null;
  };
  installationChecks: {
    put(checks: StoredChecks): void;
    get(graduateId: string, version: number): StoredChecks | null;
  };
  publications: {
    insert(publication: StoredPublication): void;
    update(publication: StoredPublication): void;
    /** A version's publication to a Hugging Face repository, if it has one. */
    find(graduateId: string, version: number, repository: string): StoredPublication | null;
    /** Oldest first. */
    list(graduateId: string): StoredPublication[];
  };
  contracts: {
    insert(contract: StoredContract): void;
    get(jobId: string, version: number): StoredContract | null;
    /** The newest version, or null before the job's first. */
    latest(jobId: string): StoredContract | null;
    /** Oldest first. */
    list(jobId: string): StoredContract[];
  };
  chats: {
    insert(chat: WorkspaceChat): void;
    update(chat: WorkspaceChat): void;
    get(id: string): WorkspaceChat | null;
    /** Most recently updated first. */
    list(graduateId: string): WorkspaceChat[];
  };
  messages: {
    insert(message: WorkspaceMessage): void;
    update(message: WorkspaceMessage): void;
    /** Oldest first. */
    list(chatId: string): WorkspaceMessage[];
  };
  /** A job's failure vocabulary. */
  categories: {
    /** Fails if the job already has the slug. */
    insert(category: Category): void;
    get(id: string): Category | null;
    /** Oldest first. */
    list(jobId: string): Category[];
  };
  interventions: {
    /** Writes the round's intervention, replacing the one recorded before. */
    put(intervention: Intervention): void;
    get(runId: string, round: number): Intervention | null;
    /** By round. */
    list(runId: string): Intervention[];
  };
  lessons: {
    /** Writes a lesson by its id, replacing one with the same id. */
    put(lesson: Lesson): void;
    get(id: string): Lesson | null;
    /** Oldest first. */
    list(filter: LessonFilter): Lesson[];
  };
  experiments: {
    /** Writes the round's experiment, replacing the one recorded before. */
    put(experiment: Experiment): void;
    get(runId: string, round: number): Experiment | null;
    /** By round. */
    list(runId: string): Experiment[];
  };
  references: {
    put(record: ReferenceRecord): void;
    get(runId: string, split: ReferenceRecord['split']): ReferenceRecord | null;
    list(runId: string): ReferenceRecord[];
    /** Oldest first, so interrupted references resume in the order they started. */
    withStatus(status: ReferenceRecord['status']): ReferenceRecord[];
  };
  /** Versions certified after the fact (decision 079). */
  certifications: {
    insert(record: StoredCertification): void;
    /** Refuses to change a finished one, which never changes. */
    update(record: StoredCertification): void;
    /** Only a planned one, which never started, can be taken back. */
    remove(id: string): void;
    get(id: string): StoredCertification | null;
    /** A version's, newest first. */
    list(graduateId: string, version: number): StoredCertification[];
    /** A run's, oldest first. */
    ofRun(runId: string): StoredCertification[];
    /** Oldest first, so interrupted ones resume in the order they started. */
    withStatus(status: StoredCertification['status']): StoredCertification[];
  };
  /** Teach this: corrections of workspace replies, by agent, oldest first. */
  corrections: {
    put(correction: Correction): void;
    get(id: string): Correction | null;
    list(graduateId: string, statuses?: readonly CorrectionStatus[]): Correction[];
  };
  /** A field's counterexamples from failing helpers (decision 078), oldest first. */
  counterexamples: {
    /** Writes one by its id, replacing one with the same id. */
    put(counterexample: Counterexample): void;
    get(id: string): Counterexample | null;
    list(filter: { jobId: string } | { runId: string; round?: number }): Counterexample[];
  };
}

export function openEngineStore(
  file: string,
  migrations: readonly Migration[] = MIGRATIONS,
): EngineStore {
  return createEngineStore(openDatabase(file, migrations));
}

function jobParams(job: JobRecord): Params {
  return {
    id: job.id,
    name: job.name,
    summary: job.summary ?? null,
    path: job.path,
    task_count: job.taskCount,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

function jobFromRow(row: Row): JobRecord {
  return JobRecordSchema.parse({
    id: row.id,
    name: row.name,
    summary: orUndefined(row.summary),
    path: row.path,
    taskCount: row.task_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function runParams({ run, ...record }: StoredRun): Params {
  return {
    id: run.id,
    job_id: run.jobId,
    method: run.method,
    seed: run.seed,
    seeds: json(record.seeds),
    status: run.status,
    phase: run.phase,
    today: record.today,
    locked_test_on: record.lockedTestOn,
    stop_requested: flag(record.stopRequested),
    current_version: run.currentVersion,
    dev_baseline: jsonOrNull(run.devBaseline),
    dev_current: jsonOrNull(run.devCurrent),
    totals: json(run.totals),
    stop_reason: run.stopReason ?? null,
    error: run.error ?? null,
    freeze: jsonOrNull(record.freeze),
    graduate_id: run.graduateId ?? null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    ended_at: run.endedAt ?? null,
    interactive: flag(record.interactive === true),
    current_adapter: jsonOrNull(run.currentAdapter),
    improves: jsonOrNull(record.improves),
    protocol: jsonOrNull(record.protocol),
  };
}

function runFromRow(row: Row): StoredRun {
  return StoredRunSchema.parse({
    run: {
      id: row.id,
      jobId: row.job_id,
      method: row.method,
      seed: row.seed,
      status: row.status,
      phase: row.phase,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      endedAt: orUndefined(row.ended_at),
      currentVersion: row.current_version,
      devBaseline: fromJson(row.dev_baseline),
      devCurrent: fromJson(row.dev_current),
      totals: fromJson(row.totals),
      stopReason: orUndefined(row.stop_reason),
      error: orUndefined(row.error),
      graduateId: orUndefined(row.graduate_id),
      currentAdapter: orUndefined(fromJson(row.current_adapter)),
    },
    seeds: fromJson(row.seeds),
    today: row.today,
    lockedTestOn: row.locked_test_on,
    stopRequested: row.stop_requested === 1,
    freeze: fromJson(row.freeze),
    ...(row.interactive === 1 ? { interactive: true } : {}),
    ...(row.improves === null || row.improves === undefined
      ? {}
      : { improves: fromJson(row.improves) }),
    ...(row.protocol === null || row.protocol === undefined
      ? {}
      : { protocol: fromJson(row.protocol) }),
  });
}

function roundParams({ round, ...record }: StoredRound): Params {
  return {
    run_id: round.runId,
    idx: round.index,
    draft: flag(round.draft === true),
    status: round.status,
    base_version: record.baseVersion,
    train: json(round.train),
    reply: jsonOrNull(record.reply),
    hypothesis: jsonOrNull(record.hypothesis),
    rejected: flag(record.rejected),
    title: round.title ?? null,
    diagnosis: round.diagnosis ?? null,
    predicted: jsonOrNull(round.predicted),
    files: json(round.files),
    candidate_version: round.candidateVersion ?? null,
    candidate_adapter: jsonOrNull(round.candidateAdapter),
    dev_before: jsonOrNull(round.devBefore),
    dev_after: jsonOrNull(round.devAfter),
    first_measurement: jsonOrNull(round.firstMeasurement),
    decision: round.decision ?? null,
    decision_reason: round.decisionReason ?? null,
    cost_usd: round.costUsd,
    error: round.error ?? null,
    started_at: round.startedAt,
    ended_at: round.endedAt ?? null,
  };
}

function roundFromRow(row: Row): StoredRound {
  return StoredRoundSchema.parse({
    round: {
      runId: row.run_id,
      index: row.idx,
      ...(row.draft === 1 ? { draft: true } : {}),
      status: row.status,
      train: fromJson(row.train),
      title: orUndefined(row.title),
      diagnosis: orUndefined(row.diagnosis),
      predicted: orUndefined(fromJson(row.predicted)),
      files: fromJson(row.files),
      candidateVersion: orUndefined(row.candidate_version),
      candidateAdapter: orUndefined(fromJson(row.candidate_adapter)),
      devBefore: orUndefined(fromJson(row.dev_before)),
      devAfter: orUndefined(fromJson(row.dev_after)),
      firstMeasurement: orUndefined(fromJson(row.first_measurement)),
      decision: orUndefined(row.decision),
      decisionReason: orUndefined(row.decision_reason),
      costUsd: row.cost_usd,
      startedAt: row.started_at,
      endedAt: orUndefined(row.ended_at),
      error: orUndefined(row.error),
    },
    baseVersion: row.base_version,
    reply: fromJson(row.reply),
    hypothesis: fromJson(row.hypothesis),
    rejected: row.rejected === 1,
  });
}

function attemptParams(attempt: StoredAttempt): Params {
  return {
    id: attempt.id,
    run_id: attempt.runId,
    round: attempt.round,
    split: attempt.split,
    harness_version: attempt.harnessVersion,
    task_id: attempt.taskId,
    task_type: attempt.taskType,
    target: attempt.target,
    config: attempt.config ?? DEFAULT_CONFIG_KEY,
    seed: attempt.seed,
    pass: flag(attempt.check.pass),
    reason: attempt.check.reason,
    details: jsonOrNull(attempt.check.details),
    stop_reason: attempt.stopReason,
    latency_ms: attempt.latencyMs,
    input_tokens: attempt.usage.inputTokens,
    output_tokens: attempt.usage.outputTokens,
    reasoning_tokens: attempt.usage.reasoningTokens ?? null,
    cached_input_tokens: attempt.usage.cachedInputTokens ?? null,
    answer_summary: attempt.answerSummary ?? null,
    expected_summary: attempt.expectedSummary ?? null,
    answer_key: attempt.answerKey ?? null,
    trace_path: attempt.tracePath,
    created_at: attempt.createdAt,
  };
}

function attemptFromRow(row: Row): StoredAttempt {
  return StoredAttemptSchema.parse({
    id: row.id,
    runId: row.run_id,
    round: row.round,
    taskId: row.task_id,
    taskType: row.task_type,
    split: row.split,
    harnessVersion: row.harness_version,
    check: {
      pass: row.pass === 1,
      reason: row.reason,
      details: orUndefined(fromJson(row.details)),
    },
    latencyMs: row.latency_ms,
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: orUndefined(row.reasoning_tokens),
      cachedInputTokens: orUndefined(row.cached_input_tokens),
    },
    answerSummary: orUndefined(row.answer_summary),
    expectedSummary: orUndefined(row.expected_summary),
    answerKey: orUndefined(row.answer_key),
    target: row.target,
    ...(row.config === DEFAULT_CONFIG_KEY ? {} : { config: row.config }),
    seed: row.seed,
    stopReason: row.stop_reason,
    tracePath: row.trace_path,
    createdAt: row.created_at,
  });
}

function lineageFromRow(row: Row): LineageIndex {
  return LineageIndexSchema.parse({
    id: row.id,
    runId: row.run_id,
    round: row.round,
    title: row.title,
    decision: row.decision,
    delta: row.delta,
    versionFrom: row.version_from,
    versionTo: row.version_to,
    at: row.at,
  });
}

function costFromRow(row: Row): CostEntry {
  return CostEntrySchema.parse({
    runId: row.run_id,
    role: row.role,
    model: row.model,
    round: row.round,
    attemptId: row.attempt_id,
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningTokens: orUndefined(row.reasoning_tokens),
      cachedInputTokens: orUndefined(row.cached_input_tokens),
    },
    usd: row.usd,
    at: row.at,
  });
}

function retestParams(retest: StoredRetest): Params {
  return {
    run_id: retest.runId,
    target: retest.target,
    status: retest.status,
    error: retest.error ?? null,
    started_at: retest.startedAt,
    ended_at: retest.endedAt ?? null,
  };
}

function qualificationParams(qualification: StoredQualification): Params {
  return {
    run_id: qualification.runId,
    org_id: qualification.orgId,
    seq: qualification.seq,
    status: qualification.status,
    body: json(qualification),
    started_at: qualification.startedAt,
  };
}

function qualificationFromRow(row: Row): StoredQualification {
  return StoredQualificationSchema.parse(fromJson(row.body));
}

function retestFromRow(row: Row): StoredRetest {
  return StoredRetestSchema.parse({
    runId: row.run_id,
    target: row.target,
    status: row.status,
    error: orUndefined(row.error),
    startedAt: row.started_at,
    endedAt: orUndefined(row.ended_at),
  });
}

function repeatParams(repeat: StoredRepeat): Params {
  return {
    run_id: repeat.runId,
    target: repeat.target,
    status: repeat.status,
    error: repeat.error ?? null,
    started_at: repeat.startedAt,
    ended_at: repeat.endedAt ?? null,
  };
}

function repeatFromRow(row: Row): StoredRepeat {
  return StoredRepeatSchema.parse({
    runId: row.run_id,
    target: row.target,
    status: row.status,
    error: orUndefined(row.error),
    startedAt: row.started_at,
    endedAt: orUndefined(row.ended_at),
  });
}

function measurementParams(measurement: RuntimeMeasurement): Params {
  return {
    id: measurement.id,
    run_id: measurement.runId,
    split: measurement.split,
    target: measurement.target,
    config: measurement.config,
    harness_version: measurement.harnessVersion,
    seeds: json(measurement.seeds),
    backend: measurement.backend,
    peak_process_bytes: measurement.peakProcessBytes,
    peak_gpu_bytes: measurement.peakGpuBytes,
    cold_start_ms: measurement.coldStartMs,
    samples: measurement.samples,
    sampler: measurement.sampler,
    started_at: measurement.startedAt,
    ended_at: measurement.endedAt,
  };
}

function measurementFromRow(row: Row): RuntimeMeasurement {
  return RuntimeMeasurementSchema.parse({
    id: row.id,
    runId: row.run_id,
    split: row.split,
    target: row.target,
    config: row.config,
    harnessVersion: row.harness_version,
    seeds: fromJson(row.seeds),
    backend: row.backend,
    peakProcessBytes: row.peak_process_bytes,
    peakGpuBytes: row.peak_gpu_bytes,
    coldStartMs: row.cold_start_ms,
    samples: row.samples,
    sampler: row.sampler,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  });
}

function graduateParams(record: GraduateRecord): Params {
  return {
    id: record.id,
    run_id: record.runId,
    name: record.name,
    path: record.path,
    // The column predates versions and can't be null; an agent made since stores JSON null.
    manifest: json(record.manifest),
    settings: jsonOrNull(record.settings),
    active_version: record.activeVersion,
    created_at: record.createdAt,
  };
}

function graduateFromRow(row: Row): GraduateRecord {
  return GraduateRecordSchema.parse({
    id: row.id,
    runId: row.run_id,
    name: row.name,
    path: row.path,
    manifest: fromJson(row.manifest),
    settings: fromJson(row.settings),
    activeVersion: row.active_version,
    createdAt: row.created_at,
  });
}

function versionParams(version: StoredVersion): Params {
  return {
    graduate_id: version.graduateId,
    version: version.version,
    parent: version.parent ?? null,
    origin: jsonOrNull(version.origin),
    path: version.path,
    manifest: json(version.manifest),
    digest: version.digest,
    contract_version: version.contractVersion,
    state: version.state,
    evaluation: version.evaluation,
    run_id: version.runId ?? null,
    source: jsonOrNull(version.source),
    created_at: version.createdAt,
    accepted_at: version.acceptedAt ?? null,
  };
}

function versionFromRow(row: Row): StoredVersion {
  return StoredVersionSchema.parse({
    graduateId: row.graduate_id,
    version: row.version,
    parent: orUndefined(row.parent),
    origin: orUndefined(fromJson(row.origin)),
    path: row.path,
    manifest: fromJson(row.manifest),
    digest: row.digest,
    contractVersion: row.contract_version,
    state: row.state,
    evaluation: row.evaluation,
    runId: orUndefined(row.run_id),
    source: orUndefined(fromJson(row.source)),
    createdAt: row.created_at,
    acceptedAt: orUndefined(row.accepted_at),
  });
}

function eventFromRow(row: Row): StoredVersionEvent {
  return StoredVersionEventSchema.parse({
    graduateId: row.graduate_id,
    kind: row.kind,
    version: row.version,
    from: orUndefined(row.from_version),
    at: row.at,
  });
}

function installationFromRow(row: Row): StoredInstallation {
  return StoredInstallationSchema.parse({
    graduateId: row.graduate_id,
    model: fromJson(row.model),
    bindings: fromJson(row.bindings),
    grants: fromJson(row.grants),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function checksFromRow(row: Row): StoredChecks {
  return StoredChecksSchema.parse({
    graduateId: row.graduate_id,
    version: row.version,
    status: row.status,
    reasons: fromJson(row.reasons),
    checks: fromJson(row.checks),
    machine: orUndefined(fromJson(row.machine)),
    measurements: fromJson(row.measurements),
    checkedAt: row.checked_at,
  });
}

function publicationParams(publication: StoredPublication): Params {
  return {
    id: publication.id,
    graduate_id: publication.graduateId,
    version: publication.version,
    destination: publication.destination,
    repository: publication.repository,
    visibility: publication.visibility,
    revision: publication.revision ?? null,
    url: publication.url ?? null,
    digest: publication.digest ?? null,
    status: publication.status,
    error: publication.error ?? null,
    created_at: publication.createdAt,
    updated_at: publication.updatedAt,
  };
}

function publicationFromRow(row: Row): StoredPublication {
  return StoredPublicationSchema.parse({
    id: row.id,
    graduateId: row.graduate_id,
    version: row.version,
    destination: row.destination,
    repository: row.repository,
    visibility: row.visibility,
    revision: orUndefined(row.revision),
    url: orUndefined(row.url),
    digest: orUndefined(row.digest),
    status: row.status,
    error: orUndefined(row.error),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function contractFromRow(row: Row): StoredContract {
  return StoredContractSchema.parse({
    jobId: row.job_id,
    version: row.version,
    contract: fromJson(row.contract),
    createdAt: row.created_at,
  });
}

function chatParams(chat: WorkspaceChat): Params {
  return {
    id: chat.id,
    graduate_id: chat.graduateId,
    title: chat.title,
    running: flag(chat.running),
    waiting: flag(chat.waiting),
    graduate_version: chat.graduateVersion ?? null,
    created_at: chat.createdAt,
    updated_at: chat.updatedAt,
  };
}

function chatFromRow(row: Row): WorkspaceChat {
  return WorkspaceChatSchema.parse({
    id: row.id,
    graduateId: row.graduate_id,
    title: row.title,
    running: row.running === 1,
    waiting: row.waiting === 1,
    graduateVersion: orUndefined(row.graduate_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function messageParams(message: WorkspaceMessage): Params {
  return {
    id: message.id,
    chat_id: message.chatId,
    role: message.role,
    status: message.status,
    body: json(message),
    graduate_version: message.graduateVersion ?? null,
    created_at: message.createdAt,
  };
}

/** A message from its JSON body; replies from before versions take the version from the column. */
function messageFromRow(row: Row): WorkspaceMessage {
  const message = WorkspaceMessageSchema.parse(fromJson(row.body));
  const version = orUndefined(row.graduate_version);
  return message.graduateVersion === undefined && typeof version === 'number'
    ? { ...message, graduateVersion: version }
    : message;
}

function attemptQuery(filter: AttemptFilter): { where: string; params: Params } {
  const clauses = ['run_id = :run_id'];
  const params: Params = { run_id: filter.runId };
  if (filter.split !== undefined) {
    clauses.push('split = :split');
    params.split = filter.split;
  }
  if (filter.version !== undefined) {
    clauses.push('harness_version = :version');
    params.version = filter.version;
  }
  if (filter.round === null) clauses.push('round IS NULL');
  else if (filter.round !== undefined) {
    clauses.push('round = :round');
    params.round = filter.round;
  }
  if (filter.target !== undefined) {
    clauses.push('target = :target');
    params.target = filter.target;
  }
  if (filter.config !== undefined) {
    clauses.push('config = :config');
    params.config = filter.config;
  }
  return { where: clauses.join(' AND '), params };
}

function lessonQuery(filter: LessonFilter): { where: string; params: Params } {
  const clauses = ['1 = 1'];
  const params: Params = {};
  if (filter.runId !== undefined) {
    clauses.push('run_id = :run_id');
    params.run_id = filter.runId;
  }
  if (filter.jobId !== undefined) {
    clauses.push('job_id = :job_id');
    params.job_id = filter.jobId;
  }
  if (filter.round !== undefined) {
    clauses.push('round = :round');
    params.round = filter.round;
  }
  if (filter.status !== undefined) {
    clauses.push('status = :status');
    params.status = filter.status;
  }
  return { where: clauses.join(' AND '), params };
}

function lessonParams(lesson: Lesson): Params {
  const parsed = LessonSchema.parse(lesson);
  const taskId = parsed.source.kind === 'correction' ? null : parsed.source.taskId;
  return {
    id: parsed.id,
    job_id: parsed.jobId,
    run_id: parsed.runId,
    round: parsed.round,
    category_id: parsed.categoryId,
    task_type: parsed.taskType,
    task_id: taskId,
    kind: parsed.kind,
    status: parsed.status,
    body: json(parsed),
    created_at: parsed.createdAt,
  };
}

/** A row's JSON body, checked against its record's schema. */
function certificationParams(record: StoredCertification): Params {
  return {
    id: record.id,
    run_id: record.runId,
    graduate_id: record.graduateId,
    version: record.version,
    seq: record.seq,
    status: record.status,
    body: json(record),
    created_at: record.createdAt,
  };
}

function bodyOf<T>(schema: { parse(value: unknown): T }, row: Row): T {
  return schema.parse(fromJson(row.body));
}

function categoryFromRow(row: Row): Category {
  return CategorySchema.parse({
    id: row.id,
    jobId: row.job_id,
    slug: row.slug,
    label: row.label,
    taskType: row.task_type,
    createdAt: row.created_at,
  });
}

export function createEngineStore(db: DatabaseSync): EngineStore {
  const sql = new Statements(db);

  return {
    transaction: (fn) => inTransaction(db, fn),
    close: () => db.close(),

    jobs: {
      insert: (job) => sql.insert('jobs', jobParams(job)),
      update: (job) => sql.update('jobs', jobParams(job), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM jobs WHERE id = :id', { id });
        return row ? jobFromRow(row) : null;
      },
      list: () =>
        sql.all('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC').map(jobFromRow),
    },

    runs: {
      insert: (record) => sql.insert('runs', runParams(record)),
      update: (record) => sql.update('runs', runParams(record), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM runs WHERE id = :id', { id });
        return row ? runFromRow(row) : null;
      },
      list: (jobId) =>
        (jobId === undefined
          ? sql.all('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC')
          : sql.all(
              'SELECT * FROM runs WHERE job_id = :job_id ORDER BY created_at DESC, rowid DESC',
              { job_id: jobId },
            )
        ).map(runFromRow),
      withStatus: (statuses) => {
        if (statuses.length === 0) return [];
        const { placeholders, params } = inList('status', statuses);
        return sql
          .all(
            `SELECT * FROM runs WHERE status IN (${placeholders}) ORDER BY created_at, rowid`,
            params,
          )
          .map(runFromRow);
      },
    },

    rounds: {
      insert: (record) => sql.insert('rounds', roundParams(record)),
      update: (record) => sql.update('rounds', roundParams(record), ['run_id', 'idx']),
      get: (runId, index) => {
        const row = sql.one('SELECT * FROM rounds WHERE run_id = :run_id AND idx = :idx', {
          run_id: runId,
          idx: index,
        });
        return row ? roundFromRow(row) : null;
      },
      list: (runId) =>
        sql
          .all('SELECT * FROM rounds WHERE run_id = :run_id ORDER BY idx', { run_id: runId })
          .map(roundFromRow),
    },

    attempts: {
      insert: (attempt) => sql.insert('attempts', attemptParams(attempt)),
      get: (id) => {
        const row = sql.one('SELECT * FROM attempts WHERE id = :id', { id });
        return row ? attemptFromRow(row) : null;
      },
      list: (filter) => {
        const { where, params } = attemptQuery(filter);
        return sql
          .all(`SELECT * FROM attempts WHERE ${where} ORDER BY created_at, rowid`, params)
          .map(attemptFromRow);
      },
      recent: (runId, splits, limit) => {
        if (splits.length === 0) return [];
        const { placeholders, params } = inList('split', splits);
        return sql
          .all(
            `SELECT * FROM attempts WHERE run_id = :run_id AND split IN (${placeholders})
             ORDER BY created_at DESC, rowid DESC LIMIT :limit`,
            { ...params, run_id: runId, limit },
          )
          .map(attemptFromRow);
      },
    },

    lineage: {
      insert: (row) =>
        sql.insert('lineage', {
          id: row.id,
          run_id: row.runId,
          round: row.round,
          title: row.title,
          decision: row.decision,
          delta: row.delta,
          version_from: row.versionFrom,
          version_to: row.versionTo,
          at: row.at,
        }),
      list: (runId) =>
        sql
          .all('SELECT * FROM lineage WHERE run_id = :run_id ORDER BY round', { run_id: runId })
          .map(lineageFromRow),
    },

    costs: {
      insert: (entry) =>
        sql.insert('costs', {
          run_id: entry.runId,
          role: entry.role,
          model: entry.model,
          round: entry.round,
          attempt_id: entry.attemptId,
          input_tokens: entry.usage.inputTokens,
          output_tokens: entry.usage.outputTokens,
          reasoning_tokens: entry.usage.reasoningTokens ?? null,
          cached_input_tokens: entry.usage.cachedInputTokens ?? null,
          usd: entry.usd,
          at: entry.at,
        }),
      list: (runId) =>
        sql
          .all('SELECT * FROM costs WHERE run_id = :run_id ORDER BY id', { run_id: runId })
          .map(costFromRow),
    },

    reports: {
      put: (card) =>
        sql.insert(
          'reports',
          {
            run_id: card.runId,
            target: card.testedOn,
            card: json(card),
            created_at: card.createdAt,
          },
          'replace',
        ),
      get: (runId, target) => {
        const row = sql.one(
          'SELECT card FROM reports WHERE run_id = :run_id AND target = :target',
          { run_id: runId, target },
        );
        return row ? ReportCardSchema.parse(fromJson(row.card)) : null;
      },
      targets: (runId) =>
        sql
          .all('SELECT target FROM reports WHERE run_id = :run_id ORDER BY created_at, rowid', {
            run_id: runId,
          })
          .map((row) => StudentTargetSchema.parse(row.target)),
    },

    retests: {
      insert: (retest) => sql.insert('retests', retestParams(retest)),
      update: (retest) => sql.update('retests', retestParams(retest), ['run_id', 'target']),
      get: (runId, target) => {
        const row = sql.one('SELECT * FROM retests WHERE run_id = :run_id AND target = :target', {
          run_id: runId,
          target,
        });
        return row ? retestFromRow(row) : null;
      },
      withStatus: (status) =>
        sql
          .all('SELECT * FROM retests WHERE status = :status ORDER BY started_at, rowid', {
            status,
          })
          .map(retestFromRow),
    },

    qualifications: {
      insert: (qualification) => sql.insert('qualifications', qualificationParams(qualification)),
      update: (qualification) =>
        sql.update('qualifications', qualificationParams(qualification), ['run_id', 'org_id']),
      get: (runId, orgId) => {
        const row = sql.one(
          'SELECT * FROM qualifications WHERE run_id = :run_id AND org_id = :org_id',
          { run_id: runId, org_id: orgId },
        );
        return row ? qualificationFromRow(row) : null;
      },
      list: (runId) =>
        sql
          .all('SELECT * FROM qualifications WHERE run_id = :run_id ORDER BY seq', {
            run_id: runId,
          })
          .map(qualificationFromRow),
      withStatus: (status) =>
        sql
          .all('SELECT * FROM qualifications WHERE status = :status ORDER BY started_at, rowid', {
            status,
          })
          .map(qualificationFromRow),
    },

    repeats: {
      insert: (repeat) => sql.insert('repeats', repeatParams(repeat)),
      update: (repeat) => sql.update('repeats', repeatParams(repeat), ['run_id', 'target']),
      get: (runId, target) => {
        const row = sql.one('SELECT * FROM repeats WHERE run_id = :run_id AND target = :target', {
          run_id: runId,
          target,
        });
        return row ? repeatFromRow(row) : null;
      },
      withStatus: (status) =>
        sql
          .all('SELECT * FROM repeats WHERE status = :status ORDER BY started_at, rowid', {
            status,
          })
          .map(repeatFromRow),
    },

    runtimeMeasurements: {
      insert: (measurement) => sql.insert('runtime_measurements', measurementParams(measurement)),
      list: (runId) =>
        sql
          .all(
            'SELECT * FROM runtime_measurements WHERE run_id = :run_id ORDER BY started_at, rowid',
            { run_id: runId },
          )
          .map(measurementFromRow),
    },

    graduates: {
      insert: (record) => sql.insert('graduates', graduateParams(record)),
      update: (record) => sql.update('graduates', graduateParams(record), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM graduates WHERE id = :id', { id });
        return row ? graduateFromRow(row) : null;
      },
      forRun: (runId) => {
        const row = sql.one('SELECT * FROM graduates WHERE run_id = :run_id', { run_id: runId });
        return row ? graduateFromRow(row) : null;
      },
      list: () =>
        sql
          .all('SELECT * FROM graduates ORDER BY created_at DESC, rowid DESC')
          .map(graduateFromRow),
      remove: (id) => {
        sql.run('DELETE FROM graduates WHERE id = :id', { id });
      },
    },

    versions: {
      insert: (version) => sql.insert('graduate_versions', versionParams(version)),
      update: (version) =>
        sql.update('graduate_versions', versionParams(version), ['graduate_id', 'version']),
      get: (graduateId, version) => {
        const row = sql.one(
          'SELECT * FROM graduate_versions WHERE graduate_id = :graduate_id AND version = :version',
          { graduate_id: graduateId, version },
        );
        return row ? versionFromRow(row) : null;
      },
      list: (graduateId) =>
        sql
          .all(
            'SELECT * FROM graduate_versions WHERE graduate_id = :graduate_id ORDER BY version',
            { graduate_id: graduateId },
          )
          .map(versionFromRow),
      forRun: (runId) => {
        const row = sql.one(
          'SELECT * FROM graduate_versions WHERE run_id = :run_id ORDER BY created_at DESC LIMIT 1',
          { run_id: runId },
        );
        return row ? versionFromRow(row) : null;
      },
      withDigest: (digest) => {
        const row = sql.one(
          `SELECT * FROM graduate_versions
           WHERE digest = :digest OR json_extract(origin, '$.digest') = :digest
           ORDER BY created_at, rowid LIMIT 1`,
          { digest },
        );
        return row ? versionFromRow(row) : null;
      },
    },

    versionEvents: {
      insert: (event) =>
        sql.insert('graduate_events', {
          graduate_id: event.graduateId,
          kind: event.kind,
          version: event.version,
          from_version: event.from ?? null,
          at: event.at,
        }),
      list: (graduateId) =>
        sql
          .all('SELECT * FROM graduate_events WHERE graduate_id = :graduate_id ORDER BY id', {
            graduate_id: graduateId,
          })
          .map(eventFromRow),
    },

    installations: {
      put: (installation) =>
        sql.insert(
          'installations',
          {
            graduate_id: installation.graduateId,
            model: json(installation.model),
            bindings: json(installation.bindings),
            grants: json(installation.grants),
            created_at: installation.createdAt,
            updated_at: installation.updatedAt,
          },
          'replace',
        ),
      get: (graduateId) => {
        const row = sql.one('SELECT * FROM installations WHERE graduate_id = :graduate_id', {
          graduate_id: graduateId,
        });
        return row ? installationFromRow(row) : null;
      },
    },

    installationChecks: {
      put: (checks) =>
        sql.insert(
          'installation_checks',
          {
            graduate_id: checks.graduateId,
            version: checks.version,
            status: checks.status,
            reasons: json(checks.reasons),
            checks: json(checks.checks),
            machine: jsonOrNull(checks.machine),
            measurements: json(checks.measurements),
            checked_at: checks.checkedAt,
          },
          'replace',
        ),
      get: (graduateId, version) => {
        const row = sql.one(
          'SELECT * FROM installation_checks WHERE graduate_id = :graduate_id AND version = :version',
          { graduate_id: graduateId, version },
        );
        return row ? checksFromRow(row) : null;
      },
    },

    publications: {
      insert: (publication) => sql.insert('publications', publicationParams(publication)),
      update: (publication) => sql.update('publications', publicationParams(publication), ['id']),
      find: (graduateId, version, repository) => {
        const row = sql.one(
          `SELECT * FROM publications WHERE graduate_id = :graduate_id AND version = :version
           AND destination = 'huggingface' AND repository = :repository`,
          { graduate_id: graduateId, version, repository },
        );
        return row ? publicationFromRow(row) : null;
      },
      list: (graduateId) =>
        sql
          .all(
            'SELECT * FROM publications WHERE graduate_id = :graduate_id ORDER BY created_at, rowid',
            { graduate_id: graduateId },
          )
          .map(publicationFromRow),
    },

    contracts: {
      insert: (contract) =>
        sql.insert('job_contracts', {
          job_id: contract.jobId,
          version: contract.version,
          contract: json(contract.contract),
          created_at: contract.createdAt,
        }),
      get: (jobId, version) => {
        const row = sql.one(
          'SELECT * FROM job_contracts WHERE job_id = :job_id AND version = :version',
          { job_id: jobId, version },
        );
        return row ? contractFromRow(row) : null;
      },
      latest: (jobId) => {
        const row = sql.one(
          'SELECT * FROM job_contracts WHERE job_id = :job_id ORDER BY version DESC LIMIT 1',
          { job_id: jobId },
        );
        return row ? contractFromRow(row) : null;
      },
      list: (jobId) =>
        sql
          .all('SELECT * FROM job_contracts WHERE job_id = :job_id ORDER BY version', {
            job_id: jobId,
          })
          .map(contractFromRow),
    },

    chats: {
      insert: (chat) => sql.insert('chats', chatParams(chat)),
      update: (chat) => sql.update('chats', chatParams(chat), ['id']),
      get: (id) => {
        const row = sql.one('SELECT * FROM chats WHERE id = :id', { id });
        return row ? chatFromRow(row) : null;
      },
      list: (graduateId) =>
        sql
          .all(
            'SELECT * FROM chats WHERE graduate_id = :graduate_id ORDER BY updated_at DESC, rowid DESC',
            { graduate_id: graduateId },
          )
          .map(chatFromRow),
    },

    messages: {
      insert: (message) => sql.insert('messages', messageParams(message)),
      update: (message) => sql.update('messages', messageParams(message), ['id']),
      list: (chatId) =>
        sql
          .all(
            'SELECT body, graduate_version FROM messages WHERE chat_id = :chat_id ORDER BY created_at, rowid',
            { chat_id: chatId },
          )
          .map(messageFromRow),
    },

    categories: {
      insert: (category) => {
        const parsed = CategorySchema.parse(category);
        sql.insert('categories', {
          id: parsed.id,
          job_id: parsed.jobId,
          slug: parsed.slug,
          label: parsed.label,
          task_type: parsed.taskType,
          created_at: parsed.createdAt,
        });
      },
      get: (id) => {
        const row = sql.one('SELECT * FROM categories WHERE id = :id', { id });
        return row ? categoryFromRow(row) : null;
      },
      list: (jobId) =>
        sql
          .all('SELECT * FROM categories WHERE job_id = :job_id ORDER BY created_at, rowid', {
            job_id: jobId,
          })
          .map(categoryFromRow),
    },

    interventions: {
      put: (intervention) => {
        const parsed = InterventionSchema.parse(intervention);
        sql.insert(
          'interventions',
          {
            id: parsed.id,
            run_id: parsed.runId,
            round: parsed.round,
            type: parsed.type,
            status: parsed.status,
            body: json(parsed),
            created_at: parsed.createdAt,
          },
          'replace',
        );
      },
      get: (runId, round) => {
        const row = sql.one(
          'SELECT body FROM interventions WHERE run_id = :run_id AND round = :round',
          { run_id: runId, round },
        );
        return row ? bodyOf(InterventionSchema, row) : null;
      },
      list: (runId) =>
        sql
          .all('SELECT body FROM interventions WHERE run_id = :run_id ORDER BY round', {
            run_id: runId,
          })
          .map((row) => bodyOf(InterventionSchema, row)),
    },

    lessons: {
      put: (lesson) => sql.insert('lessons', lessonParams(lesson), 'replace'),
      get: (id) => {
        const row = sql.one('SELECT body FROM lessons WHERE id = :id', { id });
        return row ? bodyOf(LessonSchema, row) : null;
      },
      list: (filter) => {
        const { where, params } = lessonQuery(filter);
        return sql
          .all(`SELECT body FROM lessons WHERE ${where} ORDER BY created_at, rowid`, params)
          .map((row) => bodyOf(LessonSchema, row));
      },
    },

    experiments: {
      put: (experiment) => {
        const parsed = ExperimentSchema.parse(experiment);
        sql.insert(
          'experiments',
          {
            id: parsed.id,
            run_id: parsed.runId,
            round: parsed.round,
            kind: parsed.kind,
            disposition: parsed.disposition,
            body: json(parsed),
            created_at: parsed.endedAt,
          },
          'replace',
        );
      },
      get: (runId, round) => {
        const row = sql.one(
          'SELECT body FROM experiments WHERE run_id = :run_id AND round = :round',
          { run_id: runId, round },
        );
        return row ? bodyOf(ExperimentSchema, row) : null;
      },
      list: (runId) =>
        sql
          .all('SELECT body FROM experiments WHERE run_id = :run_id ORDER BY round', {
            run_id: runId,
          })
          .map((row) => bodyOf(ExperimentSchema, row)),
    },

    references: {
      put: (record) => {
        const parsed = ReferenceRecordSchema.parse(record);
        sql.insert(
          'reference_runs',
          {
            run_id: parsed.runId,
            split: parsed.split,
            status: parsed.status,
            body: json(parsed),
            started_at: parsed.startedAt,
          },
          'replace',
        );
      },
      get: (runId, split) => {
        const row = sql.one(
          'SELECT body FROM reference_runs WHERE run_id = :run_id AND split = :split',
          { run_id: runId, split },
        );
        return row ? bodyOf(ReferenceRecordSchema, row) : null;
      },
      list: (runId) =>
        sql
          .all(
            'SELECT body FROM reference_runs WHERE run_id = :run_id ORDER BY started_at, rowid',
            { run_id: runId },
          )
          .map((row) => bodyOf(ReferenceRecordSchema, row)),
      withStatus: (status) =>
        sql
          .all(
            'SELECT body FROM reference_runs WHERE status = :status ORDER BY started_at, rowid',
            { status },
          )
          .map((row) => bodyOf(ReferenceRecordSchema, row)),
    },

    certifications: {
      insert: (record) => {
        const parsed = StoredCertificationSchema.parse(record);
        sql.insert('certifications', certificationParams(parsed));
      },
      update: (record) => {
        const parsed = StoredCertificationSchema.parse(record);
        const row = sql.one('SELECT status FROM certifications WHERE id = :id', { id: parsed.id });
        if (!row) throw new Error(`There is no certification "${parsed.id}".`);
        if (row.status === 'finished') {
          throw new Error('A finished certification is evidence, and evidence never changes.');
        }
        sql.insert('certifications', certificationParams(parsed), 'replace');
      },
      remove: (id) => {
        const row = sql.one('SELECT status FROM certifications WHERE id = :id', { id });
        if (row && row.status !== 'planned') {
          throw new Error('Only a certification that never started can be taken back.');
        }
        sql.run('DELETE FROM certifications WHERE id = :id', { id });
      },
      get: (id) => {
        const row = sql.one('SELECT body FROM certifications WHERE id = :id', { id });
        return row ? bodyOf(StoredCertificationSchema, row) : null;
      },
      list: (graduateId, version) =>
        sql
          .all(
            `SELECT body FROM certifications WHERE graduate_id = :graduate_id AND version = :version
             ORDER BY created_at DESC, rowid DESC`,
            { graduate_id: graduateId, version },
          )
          .map((row) => bodyOf(StoredCertificationSchema, row)),
      ofRun: (runId) =>
        sql
          .all('SELECT body FROM certifications WHERE run_id = :run_id ORDER BY seq', {
            run_id: runId,
          })
          .map((row) => bodyOf(StoredCertificationSchema, row)),
      withStatus: (status) =>
        sql
          .all(
            'SELECT body FROM certifications WHERE status = :status ORDER BY created_at, rowid',
            { status },
          )
          .map((row) => bodyOf(StoredCertificationSchema, row)),
    },

    corrections: {
      put: (correction) => {
        const parsed = CorrectionSchema.parse(correction);
        sql.insert(
          'corrections',
          {
            id: parsed.id,
            graduate_id: parsed.graduateId,
            status: parsed.status,
            run_id: parsed.runId ?? null,
            body: json(parsed),
            created_at: parsed.createdAt,
          },
          'replace',
        );
      },
      get: (id) => {
        const row = sql.one('SELECT body FROM corrections WHERE id = :id', { id });
        return row ? bodyOf(CorrectionSchema, row) : null;
      },
      list: (graduateId, statuses) =>
        sql
          .all(
            'SELECT body, status FROM corrections WHERE graduate_id = :graduate_id ORDER BY created_at, rowid',
            { graduate_id: graduateId },
          )
          .filter(
            (row) => statuses === undefined || statuses.includes(row.status as CorrectionStatus),
          )
          .map((row) => bodyOf(CorrectionSchema, row)),
    },

    counterexamples: {
      put: (counterexample) => {
        const parsed = CounterexampleSchema.parse(counterexample);
        sql.insert(
          'counterexamples',
          {
            id: parsed.id,
            job_id: parsed.jobId,
            run_id: parsed.runId,
            round: parsed.round,
            body: json(parsed),
            created_at: parsed.createdAt,
          },
          'replace',
        );
      },
      get: (id) => {
        const row = sql.one('SELECT body FROM counterexamples WHERE id = :id', { id });
        return row ? bodyOf(CounterexampleSchema, row) : null;
      },
      list: (filter) => {
        const query: { where: string; params: Params } =
          'jobId' in filter
            ? { where: 'job_id = :job_id', params: { job_id: filter.jobId } }
            : filter.round === undefined
              ? { where: 'run_id = :run_id', params: { run_id: filter.runId } }
              : {
                  where: 'run_id = :run_id AND round = :round',
                  params: { run_id: filter.runId, round: filter.round },
                };
        return sql
          .all(
            `SELECT body FROM counterexamples WHERE ${query.where} ORDER BY created_at, rowid`,
            query.params,
          )
          .map((row) => bodyOf(CounterexampleSchema, row));
      },
    },
  };
}
