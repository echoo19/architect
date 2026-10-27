import {
  JsonValueSchema,
  MentorViewSchema,
  type Job,
  type JsonValue,
  type LineageEntry,
  type MentorLineageItem,
  type MentorView,
  type Score,
  type Task,
  type Trace,
  type TypeScore,
} from '@architect/shared';
import { z } from 'zod';
import type { MentorDataFile } from './data-files';
import { renderCompactTrace } from './trace';

export interface TrainResult {
  task: Task;
  pass: boolean;
  reason: string;
  trace: Trace;
}

export type BudgetLeftView = MentorView['budgetLeft'];

export interface MentorViewInput {
  job: Job;
  dataFiles: MentorDataFile[];
  harnessFiles: Record<string, string>;
  round: number;
  budgetLeft: BudgetLeftView;
  train: TrainResult[];
  /** The incumbent's overall dev score: the only thing about dev the mentor learns. */
  dev: Score;
  lineage: LineageEntry[];
}

function jobView(job: Job, dataFiles: MentorDataFile[]): MentorView['job'] {
  return {
    name: job.name,
    description: job.description,
    taskTypes: job.taskTypes,
    requirements: job.requirements,
    dataFiles,
  };
}

/** A task's expected result as plain JSON, for train tasks only. */
export function expectedJson(task: Task): JsonValue {
  return JsonValueSchema.parse(JSON.parse(JSON.stringify(task.expected)));
}

/** Pass counts per task type, in the job's type order, for types with any results. */
export function scoreByType(
  results: readonly { type: string; pass: boolean }[],
  job: Job,
): TypeScore[] {
  return job.taskTypes
    .map(({ id }) => {
      const ofType = results.filter((result) => result.type === id);
      return {
        type: id,
        pass: ofType.filter((result) => result.pass).length,
        total: ofType.length,
      };
    })
    .filter((score) => score.total > 0);
}

/** What the mentor learns about earlier hypotheses: the decision and the overall dev change. */
export function mentorLineage(entries: readonly LineageEntry[]): MentorLineageItem[] {
  return entries.map((entry) => ({
    round: entry.round,
    title: entry.title,
    diagnosis: entry.diagnosis,
    files: entry.files,
    decision: entry.decision,
    devDelta: entry.measured.delta,
  }));
}

/**
 * Assembles what the mentor may see in a round from an allowlist (decision 006): the job setup,
 * the harness, this round's train attempts with checker reasons and compact traces, the overall
 * dev score, and earlier hypotheses. Dev task content, ids, traces and per-type counts never
 * appear, and nothing from the test split does.
 */
export function buildMentorView(input: MentorViewInput): MentorView {
  return MentorViewSchema.parse({
    job: jobView(input.job, input.dataFiles),
    harnessFiles: input.harnessFiles,
    round: input.round,
    budgetLeft: input.budgetLeft,
    train: {
      results: input.train.map((result) => ({
        taskId: result.task.id,
        taskType: result.task.type,
        prompt: result.task.prompt,
        expected: expectedJson(result.task),
        pass: result.pass,
        reason: result.reason,
        trace: renderCompactTrace(result.trace),
      })),
      perType: scoreByType(
        input.train.map((result) => ({ type: result.task.type, pass: result.pass })),
        input.job,
      ),
    },
    dev: { pass: input.dev.pass, total: input.dev.total },
    lineage: mentorLineage(input.lineage),
  });
}

/** What the one-shot mentor sees: the job setup and train examples with answers, no attempts. */
export const OneShotViewSchema = z.object({
  job: MentorViewSchema.shape.job,
  harnessFiles: MentorViewSchema.shape.harnessFiles,
  budgetLeft: MentorViewSchema.shape.budgetLeft,
  examples: z.array(
    z.object({
      taskId: z.string(),
      taskType: z.string(),
      prompt: z.string(),
      expected: JsonValueSchema,
    }),
  ),
  devTotal: z.number().int().nonnegative(),
});
export type OneShotView = z.infer<typeof OneShotViewSchema>;

export interface OneShotViewInput {
  job: Job;
  dataFiles: MentorDataFile[];
  harnessFiles: Record<string, string>;
  budgetLeft: BudgetLeftView;
  train: readonly Task[];
  devTotal: number;
}

export function buildOneShotView(input: OneShotViewInput): OneShotView {
  return OneShotViewSchema.parse({
    job: jobView(input.job, input.dataFiles),
    harnessFiles: input.harnessFiles,
    budgetLeft: input.budgetLeft,
    examples: input.train.map((task) => ({
      taskId: task.id,
      taskType: task.type,
      prompt: task.prompt,
      expected: expectedJson(task),
    })),
    devTotal: input.devTotal,
  });
}
