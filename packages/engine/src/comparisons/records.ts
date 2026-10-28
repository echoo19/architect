import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ArmIdSchema,
  ComparisonCapsSchema,
  ProjectionSchema,
  RuntimeIdentitySchema,
  StudentTargetSchema,
  UsageSchema,
} from '@architect/shared';
import { z } from 'zod';
import { writeFileAtomic } from '../data/atomic-write';

/*
 * What the comparisons runner keeps beside the engine's database, in its output folder: the
 * attempts it makes outside any run (calibration, the regression check, the local probe), the plan
 * it fixed before spending, and what it decided about each arm. Everything the report says comes
 * from these files and the database, never from a number typed in.
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
  /** Null when the endpoint's price isn't known; 0 on this computer. */
  usd: z.number().nonnegative().nullable(),
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

/** What the runner decided about an arm that the database can't say: why it wasn't run or stopped. */
export const ArmDecisionSchema = z.object({
  arm: ArmIdSchema,
  /** `dropped`: never started for its money or prerequisites; `stopped`: the runner stopped it. */
  kind: z.enum(['dropped', 'stopped']),
  reason: z.string().min(1),
  at: z.iso.datetime(),
});
export type ArmDecision = z.infer<typeof ArmDecisionSchema>;

/** The plan as confirmed before any arm spent: fixed, so a resumed runner follows the same one. */
export const PlanRecordSchema = z.object({
  format: z.literal(1),
  /** Null while the plan waits for the owner: nothing but calibration has spent. */
  confirmedAt: z.iso.datetime().nullable(),
  arms: z.array(ArmIdSchema),
  funded: z.array(ArmIdSchema),
  caps: ComparisonCapsSchema,
  projection: ProjectionSchema,
  /** Each funded arm's student cap, its locked test's share reserved inside it. */
  studentCaps: z.record(z.string(), z.number().nonnegative()),
  /** The job copy each arm's run started from, by arm, once imported. */
  jobs: z.record(z.string(), z.string()),
  decisions: z.array(ArmDecisionSchema),
  identities: z.record(z.string(), RuntimeIdentitySchema),
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
    return PlanRecordSchema.parse(JSON.parse(readFileSync(this.plan, 'utf8')));
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
