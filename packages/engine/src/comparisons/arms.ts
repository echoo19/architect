import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JobSchema,
  MENTOR_PRESETS,
  STUDENT_PRESETS,
  type ArmId,
  type Harness,
  type Job,
  type Method,
  type StudentTarget,
} from '@architect/shared';
import type { LoopDeps } from '../loop/deps';
import type { RunProtocol, StoredRun } from '../store/records';
import type { ComparisonEngine } from './engine';
import { JOB_PRICE_PER_HOUR, type ComparisonConfig } from './projection';
import type { ComparisonFiles } from './records';

/** Which hosted student and mentor a comparison runs, by preset, and how OpenRouter routes it. */
export interface ComparisonModels {
  /** A mentor preset key: decision 014 reports comparisons on Spark's standard tier. */
  mentor: string;
  /** A hosted student preset key. */
  student: string;
  /**
   * The providers OpenRouter may route the hosted student to, with no fallback, so every hosted
   * attempt runs on one provider's serving of the model; any provider when absent.
   */
  providers?: readonly string[];
}

export const DEFAULT_MODELS: ComparisonModels = {
  mentor: 'meta-spark',
  student: 'openrouter-glimmer',
  providers: ['DeepInfra'],
};

/**
 * The job every arm copies: the source job with the comparison's mentor and hosted student,
 * training and dev on the hosted copy, and the locked test's seeds declared (decision 037).
 */
export function comparisonJob(
  source: Job,
  config: ComparisonConfig,
  models: ComparisonModels,
): Job {
  const mentor = MENTOR_PRESETS.find((preset) => preset.key === models.mentor);
  if (!mentor) throw new Error(`There is no mentor preset "${models.mentor}".`);
  const student = STUDENT_PRESETS.find((preset) => preset.key === models.student);
  if (!student || student.runtime !== 'openai_compatible' || student.secretRef === undefined) {
    throw new Error(`"${models.student}" is not a hosted student preset.`);
  }
  return JobSchema.parse({
    ...source,
    mentor: {
      kind: 'model',
      provider: mentor.provider,
      label: 'Spark',
      baseUrl: mentor.baseUrl,
      model: mentor.model,
      reasoningEffort: 'medium',
      secretRef: mentor.secretRef,
    },
    student: {
      ...source.student,
      trainOn: 'hosted',
      hosted: {
        runtime: student.runtime,
        baseUrl: student.baseUrl,
        model: student.model,
        secretRef: student.secretRef,
        contextLength: source.student.local.contextLength,
        ...(models.providers === undefined ? {} : { providers: [...models.providers] }),
      },
    },
    evaluation: { ...source.evaluation, lockedTestSeeds: [...config.testSeeds] },
  });
}

/** What starting an arm's run takes: its job copy, method, test target and protocol. */
export interface ArmStart {
  arm: ArmId;
  job: Job;
  method: Method;
  lockedTestOn: StudentTarget;
  protocol: RunProtocol;
  /** A harness folder the job copy starts from, written beside it before it is imported. */
  startingHarness?: Harness;
}

/** What staging an arm needs to know about the arms before it. */
export interface StagingContext {
  base: Job;
  config: ComparisonConfig;
  engine: ComparisonEngine;
  deps: LoopDeps;
  files: ComparisonFiles;
  runOf(arm: ArmId): StoredRun | null;
  /** Spark dollars a run spent, from its cost ledger. */
  sparkSpent(runId: string): number;
  /** Writes a harness as a folder `importHarness` reads. */
  writeHarness(dir: string, harness: Harness): Promise<void>;
}

/** A frozen or kept harness version of another arm's run, read through the harness store. */
async function versionOf(
  context: StagingContext,
  run: StoredRun,
  version: number,
): Promise<Harness> {
  const dir = context.engine.paths.harnessDir(run.run.jobId, run.run.id);
  return context.deps.harness.versions(dir).load(version);
}

const wallMinutes = 720;

/**
 * Every arm's run: its job copy (an id of its own, so a resumed runner finds it again), method,
 * where its locked test runs, and the protocol that holds its test until every arm is frozen and
 * defers its repeat. The refining arms start from the draft arm's kept harness with the draft's
 * Spark spend taken off their cap (decision 026); the weights arms adopt the targeted arm's frozen
 * harness as H1 and train with real compute only, tested on this computer.
 */
export async function armStart(arm: ArmId, context: StagingContext): Promise<ArmStart> {
  const { base, config } = context;
  const protocol: RunProtocol = { arm, holdTest: true, deferRepeats: true };
  const copy = (changes: Partial<Job>): Job =>
    JobSchema.parse({ ...base, ...changes, id: `${base.id}-${arm}` });
  const budget = (changes: Partial<Job['budget']>): Job['budget'] => ({
    maxRounds: 1,
    maxMentorUsd: 0,
    maxWallMinutes: wallMinutes,
    ...changes,
  });
  switch (arm) {
    case 'bare':
      return {
        arm,
        job: copy({ budget: budget({}) }),
        method: 'bare',
        lockedTestOn: 'hosted',
        protocol,
      };
    case 'draft':
      return {
        arm,
        job: copy({ budget: budget({ maxMentorUsd: config.sparkCaps.draft }) }),
        method: 'one_shot',
        lockedTestOn: 'hosted',
        protocol,
      };
    case 'targeted':
    case 'fixed': {
      const draft = context.runOf('draft');
      const kept = draft?.freeze?.harnessVersion;
      const cap = arm === 'targeted' ? config.sparkCaps.targeted : config.sparkCaps.fixed;
      const spent = draft === null ? 0 : context.sparkSpent(draft.run.id);
      const draftKept =
        draft !== null &&
        context.engine.store.rounds
          .list(draft.run.id)
          .some(({ round }) => round.index === 1 && round.decision === 'kept');
      // A draft refused even after its fix leaves nothing to share: the arm drafts for itself.
      const shared = draftKept && kept !== undefined && draft !== null;
      return {
        arm,
        job: copy({
          budget: budget({
            maxRounds: config.rounds,
            maxMentorUsd: Math.max(0, cap - (shared ? spent : 0)),
          }),
          ...(shared ? { startingHarness: { kind: 'import' as const, path: 'draft' } } : {}),
        }),
        method: 'architect',
        lockedTestOn: 'hosted',
        protocol:
          arm === 'fixed' ? { ...protocol, interventions: [config.fixedIntervention] } : protocol,
        ...(shared ? { startingHarness: await versionOf(context, draft, kept) } : {}),
      };
    }
    case 'weights-one-shot':
    case 'weights-targeted': {
      const targeted = context.runOf('targeted');
      const frozen = targeted?.freeze;
      if (targeted === null || frozen === null || frozen === undefined) {
        throw new Error(
          "The weights arms adopt the targeted arm's frozen harness, and it has none.",
        );
      }
      const adopted = join(context.files.dataDir, 'comparisons', 'adopted', arm);
      await rm(adopted, { recursive: true, force: true });
      await context.writeHarness(
        adopted,
        await versionOf(context, targeted, frozen.harnessVersion),
      );
      const jobUsd = (config.jobMinutes / 60) * JOB_PRICE_PER_HOUR;
      const oneShot = arm === 'weights-one-shot';
      return {
        arm,
        job: copy({
          startingHarness: { kind: 'blank' },
          // Verified lessons go to remote training; the shop's data is synthetic (decision 045).
          sharing: { remoteTraining: true, corrections: false },
          budget: budget({
            maxRounds: 1 + (oneShot ? 1 : config.weightsRounds),
            maxMentorUsd: config.sparkCaps.weights,
            maxComputeUsd: jobUsd * (oneShot ? 1 : config.weightsRounds),
          }),
        }),
        method: 'architect',
        lockedTestOn: 'local',
        protocol: {
          ...protocol,
          adopt: context.engine.paths.toStored(adopted),
          maxJobMinutes: config.jobMinutes,
          // Its training rounds run whatever dev says: the arm measures what training adds.
          fixedRounds: true,
          ...(oneShot
            ? { oneShotAdapter: { perType: config.oneShotPerType } }
            : { interventions: ['weights' as const] }),
        },
      };
    }
    case 'reference':
    case 'repeat':
      throw new Error(`The ${arm} arm measures other arms' runs; it has no run of its own.`);
  }
}

/**
 * Writes a job copy into `dir` beside the source job's tasks, data and checker, ready to import,
 * with the harness it starts from when it imports one.
 */
export async function stageFolder(
  sourceDir: string,
  dir: string,
  job: Job,
  writeHarness: StagingContext['writeHarness'],
  startingHarness?: Harness,
): Promise<string> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp(sourceDir, dir, { recursive: true });
  if (startingHarness !== undefined) await writeHarness(join(dir, 'draft'), startingHarness);
  const file = join(dir, 'job.json');
  await writeFile(file, `${JSON.stringify(job, null, 2)}\n`);
  return file;
}
