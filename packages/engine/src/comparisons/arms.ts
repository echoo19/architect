import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_STUDENT,
  GLIMMER_BUILDS,
  JobSchema,
  MENTOR_PRESETS,
  STUDENT_PRESETS,
  type ArmId,
  type ExperimentModels,
  type Harness,
  type Job,
  type Method,
  type ModelMentor,
  type StudentEndpoint,
  type StudentTarget,
} from '@architect/shared';
import { isStudied } from '../drafting/study';
import type { LoopDeps } from '../loop/deps';
import type { RunProtocol, StoredRun } from '../store/records';
import type { ComparisonEngine } from './engine';
import { JOB_PRICE_PER_HOUR, type ComparisonConfig } from './projection';
import type { ComparisonFiles } from './records';

/**
 * Which mentor and hosted student a comparison runs, and how OpenRouter routes it: a preset by
 * its key, or the field's own model by its whole address (decision 094). The providers pin the
 * hosted student to one serving of the model; `localModel` is the build on this computer every
 * graduate is pinned to when it freezes, the one local tests run on, and the base adapters use.
 */
export type ComparisonModels = ExperimentModels;

export const DEFAULT_MODELS: ComparisonModels = {
  // Decision 014 reports comparisons on Spark's standard tier.
  mentor: 'meta-spark',
  student: 'openrouter-glimmer',
  providers: ['DeepInfra'],
  // The 2-bit build that fits this computer's 12 GB GPU (decision 034).
  localModel: 'muse-glimmer:30b-iq2',
};

const isGlimmer = (model: string) => GLIMMER_BUILDS.some((build) => build.model === model);

/**
 * The models a comparison on this field runs (decision 094): the field's own teacher and the
 * hosted copy of its student, each by its preset key where a preset is that model at that
 * address, and the defaults where the field has none (a coding agent teaches, or the student has
 * no hosted copy). A field on Glimmer keeps the defaults' routing and the build that fits here.
 */
export function fieldModels(job: Job): ComparisonModels {
  const { mentor } = job;
  const mentorPreset =
    mentor.kind === 'model'
      ? MENTOR_PRESETS.find(
          (preset) => preset.model === mentor.model && preset.baseUrl === mentor.baseUrl,
        )
      : undefined;
  const chosen: ComparisonModels['mentor'] =
    mentor.kind === 'model' ? (mentorPreset?.key ?? mentor) : DEFAULT_MODELS.mentor;
  const hosted = job.student.hosted;
  if (hosted === undefined || hosted.runtime !== 'openai_compatible') {
    return { ...DEFAULT_MODELS, mentor: chosen };
  }
  const preset = STUDENT_PRESETS.find(
    (candidate) => candidate.model === hosted.model && candidate.baseUrl === hosted.baseUrl,
  );
  const providers =
    hosted.providers ??
    (preset?.key === DEFAULT_MODELS.student ? DEFAULT_MODELS.providers : undefined);
  const local = job.student.local.model;
  return {
    mentor: chosen,
    student: preset?.key ?? hosted,
    ...(providers === undefined ? {} : { providers: [...providers] }),
    localModel: preset !== undefined || isGlimmer(local) ? DEFAULT_MODELS.localModel : local,
  };
}

/**
 * How a plan's settings name the models, which a resume must ask for again: a preset by its key,
 * any other model as `model at address`.
 */
export function modelKeys(models: ComparisonModels): { mentor: string; student: string } {
  const named = (model: string | { model: string; baseUrl: string }) =>
    typeof model === 'string' ? model : `${model.model} at ${model.baseUrl}`;
  return { mentor: named(models.mentor), student: named(models.student) };
}

/** The mentor a comparison's models name, as its job's settings. */
function mentorOf(models: ComparisonModels): ModelMentor {
  if (typeof models.mentor !== 'string') return { ...models.mentor, reasoningEffort: 'medium' };
  const key = models.mentor;
  const preset = MENTOR_PRESETS.find((candidate) => candidate.key === key);
  if (!preset) throw new Error(`There is no mentor preset "${key}".`);
  return {
    kind: 'model',
    provider: preset.provider,
    label: key === DEFAULT_MODELS.mentor ? 'Spark' : preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    reasoningEffort: 'medium',
    secretRef: preset.secretRef,
  };
}

/** The hosted student a comparison's models name, and the label its job gives the student. */
function hostedOf(
  models: ComparisonModels,
  source: Job,
): { label: string; hosted: Omit<StudentEndpoint, 'contextLength' | 'providers'> } {
  if (typeof models.student !== 'string') {
    const { contextLength: _context, providers: _providers, ...hosted } = models.student;
    return { label: source.student.label, hosted };
  }
  const key = models.student;
  const preset = STUDENT_PRESETS.find((candidate) => candidate.key === key);
  if (!preset || preset.runtime !== 'openai_compatible' || preset.secretRef === undefined) {
    throw new Error(`"${key}" is not a hosted student preset.`);
  }
  return {
    // Every hosted preset is a copy of Glimmer, whatever the field's own student is.
    label: isGlimmer(source.student.local.model) ? source.student.label : DEFAULT_STUDENT.label,
    hosted: {
      runtime: preset.runtime,
      baseUrl: preset.baseUrl,
      model: preset.model,
      secretRef: preset.secretRef,
    },
  };
}

/**
 * The job every arm copies: the source job with the comparison's mentor and hosted student,
 * training and dev on the hosted copy, and the locked test's seeds declared (decision 037).
 */
export function comparisonJob(
  source: Job,
  config: ComparisonConfig,
  models: ComparisonModels,
): Job {
  const { label, hosted } = hostedOf(models, source);
  return JobSchema.parse({
    ...source,
    mentor: mentorOf(models),
    student: {
      ...source.student,
      label,
      local: { ...source.student.local, model: models.localModel },
      trainOn: 'hosted',
      hosted: {
        ...hosted,
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
  /** The arm's projected wall clock, which its run's wall cap is set from. */
  wallMinutes: number;
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

/** An arm's wall cap: twice its projected wall clock, never under 12 hours or over a week. */
function wallCap(projected: number): number {
  return Math.min(10_080, Math.max(720, Math.ceil(2 * projected)));
}

/**
 * Every arm's run: its job copy (an id of its own, so a resumed runner finds it again), method,
 * where its locked test runs, and the protocol that holds its test until every arm is frozen and
 * defers its repeat. The refining arms start from the draft arm's kept harness with the draft's
 * Spark spend taken off their cap (decision 026); the weights arms adopt the targeted arm's frozen
 * harness as H1 and train with real compute only, tested on this computer. Under the reduced
 * protocol the one-shot adapter starts from H1 itself (decision 051).
 */
export async function armStart(arm: ArmId, context: StagingContext): Promise<ArmStart> {
  const { base, config } = context;
  const protocol: RunProtocol = { arm, holdTest: true, deferRepeats: true };
  const copy = (changes: Partial<Job>): Job =>
    JobSchema.parse({ ...base, ...changes, id: `${base.id}-${arm}` });
  const budget = (changes: Partial<Job['budget']>): Job['budget'] => ({
    maxRounds: 1,
    maxMentorUsd: 0,
    maxWallMinutes: wallCap(context.wallMinutes),
    ...changes,
  });
  switch (arm) {
    case 'bare':
      // Untaught: on a field job the blank harness is imported as it is, so the confirmed study's
      // procedure, which seeds a blank start, isn't added to it.
      return isStudied(base)
        ? {
            arm,
            job: copy({
              budget: budget({}),
              startingHarness: { kind: 'import' as const, path: 'draft' },
            }),
            method: 'bare',
            lockedTestOn: 'hosted',
            protocol,
            startingHarness: context.deps.harness.blankHarness(base.name, base.description),
          }
        : {
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
      const h1 = await versionOf(context, targeted, frozen.harnessVersion);
      const jobUsd = (config.jobMinutes / 60) * JOB_PRICE_PER_HOUR;
      const oneShot = arm === 'weights-one-shot';
      if (oneShot && config.adapterProtocol === 'reduced') {
        // The reduced protocol (decision 051): it starts from the targeted arm's frozen harness,
        // trains one adapter on it, checks it on a few train tasks, and takes its locked test
        // with and without the adapter on one llama-server.
        return {
          arm,
          job: copy({
            startingHarness: { kind: 'import', path: 'draft' },
            sharing: { remoteTraining: true, corrections: false },
            budget: budget({
              maxRounds: 1,
              maxMentorUsd: config.sparkCaps.weights,
              maxComputeUsd: jobUsd,
            }),
          }),
          method: 'architect',
          lockedTestOn: 'local',
          protocol: {
            ...protocol,
            maxJobMinutes: config.jobMinutes,
            fixedRounds: true,
            oneShotAdapter: { perType: config.oneShotPerType, smokeTasks: config.smokeTasks },
            pairedWithoutAdapter: true,
          },
          startingHarness: h1,
        };
      }
      const adopted = join(context.files.dataDir, 'comparisons', 'adopted', arm);
      await rm(adopted, { recursive: true, force: true });
      await context.writeHarness(adopted, h1);
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
    case 'reference-targeted':
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
