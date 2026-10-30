import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  AdapterProtocolSchema,
  ArmIdSchema,
  BillingSchema,
  COMPARISON_REPORT_FORMAT,
  ComparisonCapsSchema,
  ComparisonReportSchema,
  PinnedInputsSchema,
  ProjectionSchema,
  RuntimeIdentitySchema,
  StudentTargetSchema,
  StudyRecordSchema,
  UsageSchema,
  type ComparisonReport,
  type PinnedInputs,
  type StudyRecord,
} from '@architect/shared';
import { z } from 'zod';
import { writeFileAtomic } from '../data/atomic-write';

/*
 * What the comparisons runner keeps beside the engine's database, in its output folder: the
 * attempts it makes outside any run (calibration, the regression check, the local probe), the
 * journal of every hosted request, the plan it fixed before spending, and what it decided about
 * each arm. Everything the report says comes from these files and the database, never from a
 * number typed in.
 */

/** One attempt the runner made outside a run, written as it finished. */
export const SweepAttemptSchema = z.object({
  taskId: z.string(),
  taskType: z.string(),
  target: StudentTargetSchema,
  pass: z.boolean(),
  refused: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  usage: UsageSchema,
  /**
   * What it cost: what the provider billed for each call that said, the listed price of the
   * others. Null when a call's cost is known neither way; 0 on this computer.
   */
  usd: z.number().nonnegative().nullable(),
  /** The listed price of its usage, for holding up against the bill; null without a price. */
  listedUsd: z.number().nonnegative().nullable(),
  /** Its model calls, and how many of them the provider said it billed, for how much. */
  calls: z.number().int().nonnegative(),
  billedCalls: z.number().int().nonnegative(),
  billedUsd: z.number().nonnegative(),
  seed: z.number().int(),
  at: z.iso.datetime(),
});
export type SweepAttempt = z.infer<typeof SweepAttemptSchema>;

/** A local probe's runtime readings, beside its attempts. */
export const ProbeReadingSchema = z.object({
  backend: z.string(),
  coldStartMs: z.number().int().nonnegative().nullable(),
  peakProcessBytes: z.number().int().nonnegative().nullable(),
  peakGpuBytes: z.number().int().nonnegative().nullable(),
  sampler: z.string(),
  at: z.iso.datetime(),
});
export type ProbeReading = z.infer<typeof ProbeReadingSchema>;

/**
 * What the runner decided about an arm that the database can't say: why it wasn't run, was
 * stopped, or had its locked test held. A decision is final: a later run of the same plan never
 * starts an arm it dropped or releases a test it held.
 */
export const ArmDecisionSchema = z.object({
  arm: ArmIdSchema,
  /**
   * `dropped`: never started, for its money or prerequisites; `stopped`: the runner stopped it;
   * `held`: its locked test stayed held, since the credit couldn't pay for it.
   */
  kind: z.enum(['dropped', 'stopped', 'held']),
  reason: z.string().min(1),
  at: z.iso.datetime(),
});
export type ArmDecision = z.infer<typeof ArmDecisionSchema>;

/**
 * Every setting that changes what a comparison spends or measures, as the plan was confirmed
 * with: a resumed runner refuses other settings, so a resume can't quietly change the plan.
 */
export const PlanSettingsSchema = z.object({
  mentoringSeed: z.number().int(),
  testSeeds: z.array(z.number().int()),
  rounds: z.number().int(),
  weightsRounds: z.number().int(),
  oneShotPerType: z.number().int(),
  jobMinutes: z.number().int(),
  fixedIntervention: z.string(),
  headroom: z.number(),
  concurrency: z.number().int(),
  localOllama: z.boolean(),
  realCompute: z.boolean(),
  llamaServer: z.boolean(),
  adapterProtocol: AdapterProtocolSchema,
  smokeTasks: z.number().int(),
  sparkCaps: z.record(z.string(), z.number()),
  studentCaps: z.record(z.string(), z.number()),
  mentor: z.string(),
  student: z.string(),
  providers: z.array(z.string()).nullable(),
  localModel: z.string(),
});
export type PlanSettings = z.infer<typeof PlanSettingsSchema>;

/** The plan file's format; an older one is refused, never read with other meanings. */
export const PLAN_FORMAT = 2;

/** The plan as confirmed before any arm spent: fixed, so a resumed runner follows the same one. */
export const PlanRecordSchema = z.object({
  format: z.literal(PLAN_FORMAT),
  /** Null while the plan waits for the owner: nothing but calibration has spent. */
  confirmedAt: z.iso.datetime().nullable(),
  arms: z.array(ArmIdSchema),
  funded: z.array(ArmIdSchema),
  caps: ComparisonCapsSchema,
  settings: PlanSettingsSchema,
  /** The job and the regression check's job, pinned by their files; a run on others is refused. */
  inputs: z.object({ job: PinnedInputsSchema, regression: PinnedInputsSchema.nullable() }),
  /** Calibration's cost held up against the provider's billing. */
  billing: BillingSchema.nullable(),
  projection: ProjectionSchema,
  /** Each funded arm's student cap, its locked test's share reserved inside it. */
  studentCaps: z.record(z.string(), z.number().nonnegative()),
  decisions: z.array(ArmDecisionSchema),
  identities: z.record(z.string(), RuntimeIdentitySchema),
  /**
   * The test-release barrier: when the first locked result was released. From then on no arm
   * starts or goes on developing, so nothing learns after a locked result exists.
   */
  releasedAt: z.iso.datetime().nullable(),
});
export type PlanRecord = z.infer<typeof PlanRecordSchema>;

/** The runner's files in its output folder. */
export class ComparisonFiles {
  constructor(readonly out: string) {}

  get dataDir(): string {
    return join(this.out, 'data');
  }

  get plan(): string {
    return join(this.out, 'plan.json');
  }

  sweep(name: 'calibration' | 'regression' | 'probe'): string {
    return join(this.out, `${name}.jsonl`);
  }

  get probeReading(): string {
    return join(this.out, 'probe.json');
  }

  /** The request journal: every hosted request, written before it is sent. */
  get journal(): string {
    return join(this.out, 'requests.jsonl');
  }

  /** The job's files as the folder's first command found them, before anything was imported. */
  get pinnedJob(): string {
    return join(this.out, 'inputs.json');
  }

  readPinnedJob(): PinnedInputs | null {
    if (!existsSync(this.pinnedJob)) return null;
    return PinnedInputsSchema.parse(JSON.parse(readFileSync(this.pinnedJob, 'utf8')));
  }

  writePinnedJob(pinned: PinnedInputs): void {
    mkdirSync(this.out, { recursive: true });
    writeFileAtomic(
      this.pinnedJob,
      `${JSON.stringify(PinnedInputsSchema.parse(pinned), null, 2)}\n`,
    );
  }

  /** Spark's brief of a field job's organizations, for the person to read and confirm. */
  get study(): string {
    return join(this.out, 'study.json');
  }

  writeStudy(record: StudyRecord): void {
    mkdirSync(this.out, { recursive: true });
    writeFileAtomic(this.study, `${JSON.stringify(StudyRecordSchema.parse(record), null, 2)}\n`);
  }

  staging(arm: string): string {
    return join(this.out, 'staging', arm);
  }

  get reportJson(): string {
    return join(this.out, 'report.json');
  }

  get reportMarkdown(): string {
    return join(this.out, 'report.md');
  }

  readPlan(): PlanRecord | null {
    if (!existsSync(this.plan)) return null;
    const raw: unknown = JSON.parse(readFileSync(this.plan, 'utf8'));
    const format = (raw as { format?: unknown }).format;
    if (format !== PLAN_FORMAT) {
      throw new Error(
        `${this.plan} was written by an earlier runner (plan format ${String(format)}), which pinned less than this one holds a run to. Start the comparison in a new output folder.`,
      );
    }
    return PlanRecordSchema.parse(raw);
  }

  writePlan(plan: PlanRecord): void {
    mkdirSync(this.out, { recursive: true });
    writeFileAtomic(this.plan, `${JSON.stringify(PlanRecordSchema.parse(plan), null, 2)}\n`);
  }

  readSweep(name: 'calibration' | 'regression' | 'probe'): SweepAttempt[] {
    const file = this.sweep(name);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => SweepAttemptSchema.parse(JSON.parse(line)));
  }

  /** Appends one finished attempt, so a crash keeps every attempt that finished before it. */
  async appendSweep(name: 'calibration' | 'regression' | 'probe', attempt: SweepAttempt) {
    const file = this.sweep(name);
    mkdirSync(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(SweepAttemptSchema.parse(attempt))}\n`);
  }

  readProbe(): ProbeReading | null {
    if (!existsSync(this.probeReading)) return null;
    return ProbeReadingSchema.parse(JSON.parse(readFileSync(this.probeReading, 'utf8')));
  }

  writeProbe(reading: ProbeReading): void {
    mkdirSync(this.out, { recursive: true });
    writeFileAtomic(this.probeReading, `${JSON.stringify(ProbeReadingSchema.parse(reading))}\n`);
  }
}

/**
 * The report a comparison left beside a data folder the app opened, for the app to read: only
 * when the folder is a comparison's `data` folder, with its `report.json` beside it. Null when
 * there is none, or when the file there isn't in the runner's format; a file in its format that
 * doesn't parse is an error that says where it is.
 */
export async function reportBeside(dataDir: string): Promise<ComparisonReport | null> {
  const files = new ComparisonFiles(dirname(resolve(dataDir)));
  if (files.dataDir !== resolve(dataDir) || !existsSync(files.reportJson)) return null;
  const stored: unknown = JSON.parse(await readFile(files.reportJson, 'utf8'));
  if ((stored as { format?: unknown } | null)?.format !== COMPARISON_REPORT_FORMAT) return null;
  const parsed = ComparisonReportSchema.safeParse(stored);
  if (!parsed.success) {
    throw new Error(
      `The comparisons report beside this data folder (${files.reportJson}) doesn't match its format, so it can't be shown.`,
    );
  }
  return parsed.data;
}
