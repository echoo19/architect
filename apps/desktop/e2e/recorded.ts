import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  ComparisonReportSchema,
  ExperimentDispositionSchema,
  type ComparisonReport,
} from '@architect/shared';
import { z } from 'zod';

/** Where the global setup leaves the recorded run's data folder for the specs. */
export const RECORDED_ENV = 'ARCHITECT_RECORDED_RUN';

/** Where it leaves the recorded comparison: the runner's output folder, `data` and its report. */
export const RECORDED_COMPARISON_ENV = 'ARCHITECT_RECORDED_COMPARISON';

/** The part of the recorder's summary the specs find their records by. */
const RecordedSummarySchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  graduateId: z.string().nullable(),
  rounds: z.array(
    z.object({
      round: z.number().int().positive(),
      experimentId: z.string(),
      disposition: ExperimentDispositionSchema,
      lessons: z.array(z.object({ id: z.string() })),
    }),
  ),
  repair: z.object({
    attemptId: z.string(),
    taskId: z.string(),
    failureTurn: z.number().int().positive(),
    lessonId: z.string(),
  }),
});
export type RecordedSummary = z.infer<typeof RecordedSummarySchema>;

/** The recorded run's data folder, which a launch copies into its own profile. */
export function recordedData(): string {
  const folder = process.env[RECORDED_ENV];
  if (!folder) throw new Error(`${RECORDED_ENV} isn't set: the e2e global setup records the run.`);
  return folder;
}

export async function recordedSummary(): Promise<RecordedSummary> {
  const text = await readFile(join(recordedData(), 'recorded-run.json'), 'utf8');
  return RecordedSummarySchema.parse(JSON.parse(text));
}

/** The recorded comparison's output folder, which a launch opens as the runner left it. */
export function recordedComparison(): string {
  const folder = process.env[RECORDED_COMPARISON_ENV];
  if (!folder) {
    throw new Error(`${RECORDED_COMPARISON_ENV} isn't set: the e2e global setup records it.`);
  }
  return folder;
}

/** The recorded comparison's report, as the runner wrote it beside its data folder. */
export async function recordedComparisonReport(): Promise<ComparisonReport> {
  const text = await readFile(join(recordedComparison(), 'report.json'), 'utf8');
  return ComparisonReportSchema.parse(JSON.parse(text));
}

/**
 * The recorded comparison as a real one would read, for the screenshots: the dry run's report
 * with its label and the lines that say no model was called taken out. Its numbers stay the ones
 * the dry run recorded, stand-ins as every capture's data is, and the engine's own tests keep the
 * dry run labelled as one. Passed to `launchApp` as `prepare`, it rewrites the profile's copy.
 */
export async function asRealComparison(userData: string): Promise<void> {
  const file = join(dirname(userData), 'report.json');
  const report = ComparisonReportSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const real: ComparisonReport = {
    ...report,
    dryRun: false,
    disclosures: report.disclosures.filter((line) => !/dry run/i.test(line)),
  };
  await writeFile(file, JSON.stringify(real));
}

/** How many examples the run recorded, verified or not. */
export function lessonCount(summary: RecordedSummary): number {
  return summary.rounds.reduce((sum, round) => sum + round.lessons.length, 0);
}

/** The round a disposition first happened in, from the summary. */
export function roundWith(
  summary: RecordedSummary,
  disposition: RecordedSummary['rounds'][number]['disposition'],
): number {
  const round = summary.rounds.find((item) => item.disposition === disposition);
  if (!round) throw new Error(`The recorded run has no ${disposition} round.`);
  return round.round;
}
