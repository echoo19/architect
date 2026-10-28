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
import type { PayloadPart } from './gate';
import { renderCompactTrace } from './trace';

export interface TrainResult {
  task: Task;
  pass: boolean;
  reason: string;
  trace: Trace;
}

export type BudgetLeftView = MentorView['budgetLeft'];

/** A round the runner rejected before dev saw its change, and why. */
export interface RejectedRound {
  round: number;
  /** Absent when the reply held no usable hypothesis. */
  title?: string;
  files: string[];
  reason: string;
}

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
  rejected: RejectedRound[];
  /** For a mentor choosing from the intervention menu: the menu, the vocabulary, the answers. */
  mentoring?: MentorView['mentoring'];
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

/** A rejection reason fits on one line in the lineage; past this it is cut short. */
const REASON_MAX = 400;

/** A reason on one line, such as a harness check's one sentence per problem run together. */
function shortReason(reason: string): string {
  const line = reason.replace(/\s+/g, ' ').trim();
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1)}…` : line;
}

/**
 * What the mentor learns about earlier rounds, in order: for a measured change the decision and
 * the overall dev change (on the first measurement, and over both when it was measured again),
 * for a rejected one the reason, so it can put the mistake right.
 */
export function mentorLineage(
  entries: readonly LineageEntry[],
  rejected: readonly RejectedRound[],
): MentorLineageItem[] {
  const measured = entries.map((entry): MentorLineageItem => {
    const first = entry.measured.firstMeasurement;
    return {
      round: entry.round,
      title: entry.title,
      diagnosis: entry.diagnosis,
      files: entry.files,
      decision: entry.decision,
      ...(first
        ? {
            devDelta: first.devAfter.pass - first.devBefore.pass,
            confirmedDelta: entry.measured.delta,
          }
        : { devDelta: entry.measured.delta }),
    };
  });
  const rejections = rejected.map((item): MentorLineageItem => ({
    round: item.round,
    ...(item.title === undefined ? {} : { title: item.title }),
    files: item.files,
    decision: 'rejected',
    reason: shortReason(item.reason),
  }));
  return [...measured, ...rejections].sort((a, b) => a.round - b.round);
}

/**
 * Assembles what the mentor may see in a round from an allowlist (decision 006): the job setup,
 * the harness, this round's train attempts with checker reasons and compact traces, the overall
 * dev score, and earlier hypotheses, rejected ones with their reasons. Dev task content, ids,
 * traces and per-type counts never appear, and nothing from the test split does.
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
    lineage: mentorLineage(input.lineage, input.rejected),
    ...(input.mentoring === undefined ? {} : { mentoring: input.mentoring }),
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

function setupParts(view: MentorView | OneShotView): PayloadPart[] {
  const { dataFiles, ...job } = view.job;
  return [
    { label: 'the job description', text: JSON.stringify(job) },
    ...dataFiles.map((file) => ({ label: `data file ${file.name}`, text: JSON.stringify(file) })),
    ...Object.entries(view.harnessFiles).map(([path, text]) => ({
      label: `harness file ${path}`,
      text,
    })),
  ];
}

/** A round's view in parts by origin, so the gate can say where a refused payload matched. */
export function mentorViewParts(view: MentorView): PayloadPart[] {
  return [
    ...setupParts(view),
    ...view.train.results.map((result) => ({
      label: `train task ${result.taskId}`,
      text: JSON.stringify(result),
    })),
    { label: 'the earlier hypotheses', text: JSON.stringify(view.lineage) },
    ...(view.mentoring === undefined
      ? []
      : [
          { label: 'the failure vocabulary', text: JSON.stringify(view.mentoring.categories) },
          { label: "the person's answers", text: JSON.stringify(view.mentoring.answers) },
        ]),
  ];
}

export function oneShotViewParts(view: OneShotView): PayloadPart[] {
  return [
    ...setupParts(view),
    ...view.examples.map((example) => ({
      label: `train task ${example.taskId}`,
      text: JSON.stringify(example),
    })),
  ];
}
