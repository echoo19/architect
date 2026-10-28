import {
  newId,
  slugify,
  TraceSchema,
  type Category,
  type FindingDraft,
  type Finding,
  type Hypothesis,
  type Intervention,
  type InterventionPlan,
  type Task,
  type Trace,
} from '@architect/shared';
import type { StoredAttempt } from '../store/records';
import { traceTurns } from '../teaching/checkpoint';
import { must } from './errors';
import { readJsonFile } from './files';
import type { RunState } from './run-state';

/** Findings a round takes, at most; the rest are set aside. */
export const MAX_FINDINGS = 3;
/** Categories a job's vocabulary holds, at most, so new slugs can't grow it without end. */
export const MAX_CATEGORIES = 16;

const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A failed train attempt of the round, with its trace and task. */
export interface FailedAttempt {
  attempt: StoredAttempt;
  trace: Trace;
  task: Task;
}

/** The round's failed train attempts on the incumbent, by task id. */
export async function failedAttempts(
  state: RunState,
  index: number,
): Promise<Map<string, FailedAttempt>> {
  const { baseVersion } = state.round(index);
  const tasks = new Map((await state.trainBatch(index)).map((task) => [task.id, task]));
  const failed = new Map<string, FailedAttempt>();
  for (const attempt of state.attempts({ split: 'train', round: index, version: baseVersion })) {
    const task = tasks.get(attempt.taskId);
    if (attempt.check.pass || task === undefined || attempt.tracePath === null) continue;
    const trace = TraceSchema.parse(
      await readJsonFile(state.ctx.paths.fromStored(attempt.tracePath)),
    );
    failed.set(attempt.taskId, { attempt, trace, task });
  }
  return failed;
}

/**
 * The category a finding names: an existing one by id, else by its slug once normalized, else a
 * new one while the job's vocabulary has room. A new slug for an old failure gets a new id, but
 * the caps that matter count by task type too, so it buys no more lessons.
 */
function resolveCategory(
  state: RunState,
  draft: FindingDraft,
  taskType: string,
): { category: Category } | { reason: string } {
  const { store } = state.ctx;
  const jobId = state.run.jobId;
  const existing = store.categories.list(jobId);
  const byId = existing.find((category) => category.id === draft.category.id.trim());
  if (byId) return { category: byId };
  const slug = slugify(draft.category.slug.trim() || draft.category.label).slice(0, 48);
  const bySlug = existing.find((category) => category.slug === slug);
  if (bySlug) return { category: bySlug };
  if (!SLUG.test(slug) || slug === 'item') {
    return { reason: 'its category has neither an id from the vocabulary nor a usable slug' };
  }
  if (existing.length >= MAX_CATEGORIES) {
    return {
      reason: `the job's failure vocabulary already holds ${MAX_CATEGORIES} categories, so a finding has to reuse one`,
    };
  }
  const label = draft.category.label.trim().slice(0, 80) || slug;
  const category: Category = {
    id: newId('cat'),
    jobId,
    slug,
    label,
    taskType,
    createdAt: state.now(),
  };
  store.categories.insert(category);
  return { category };
}

/** Why a finding doesn't hold against its attempt, or null when it does. */
function findingProblem(draft: FindingDraft, failed: FailedAttempt | undefined): string | null {
  if (failed === undefined) return "it isn't a failed train attempt of this round";
  const turns = traceTurns(failed.trace).length;
  if (draft.failureTurn < 1 || draft.failureTurn > turns) {
    return `the attempt took ${turns} model turns, so turn ${draft.failureTurn} isn't one of them`;
  }
  if (draft.cause.trim() === '') return 'it names no cause';
  const evidence = draft.evidence.filter(
    (item) => item.turn >= 1 && item.turn <= turns && item.note.trim() !== '',
  );
  if (evidence.length === 0) return 'its evidence points at no turn of the attempt';
  return null;
}

export interface ResolvedFindings {
  findings: Finding[];
  setAside: { taskId: string; reason: string }[];
}

/**
 * The mentor's findings checked against this round's failed attempts: each must name a failed
 * train attempt shown this round, a turn inside it, evidence that points at its turns, a cause,
 * and a category. The ones that don't hold are set aside with the reason; the rest keep their
 * task's own type, whatever type the mentor wrote.
 */
export async function resolveFindings(
  state: RunState,
  index: number,
  drafts: readonly FindingDraft[],
): Promise<ResolvedFindings> {
  const failed = await failedAttempts(state, index);
  const findings: Finding[] = [];
  const setAside: ResolvedFindings['setAside'] = [];
  for (const draft of drafts) {
    if (findings.length >= MAX_FINDINGS) {
      setAside.push({ taskId: draft.taskId, reason: `only the first ${MAX_FINDINGS} are taken` });
      continue;
    }
    if (findings.some((finding) => finding.taskId === draft.taskId)) {
      setAside.push({ taskId: draft.taskId, reason: 'its attempt already has a finding' });
      continue;
    }
    const attempt = failed.get(draft.taskId);
    const problem = findingProblem(draft, attempt);
    if (problem !== null || attempt === undefined) {
      setAside.push({ taskId: draft.taskId, reason: problem ?? 'its attempt is missing' });
      continue;
    }
    const resolved = resolveCategory(state, draft, attempt.task.type);
    if ('reason' in resolved) {
      setAside.push({ taskId: draft.taskId, reason: resolved.reason });
      continue;
    }
    const turns = traceTurns(attempt.trace).length;
    findings.push({
      attemptId: attempt.attempt.id,
      taskId: draft.taskId,
      taskType: attempt.task.type,
      failureTurn: draft.failureTurn,
      evidence: draft.evidence
        .filter((item) => item.turn >= 1 && item.turn <= turns && item.note.trim() !== '')
        .map((item) => ({ turn: item.turn, note: item.note.trim() })),
      cause: draft.cause.trim(),
      categoryId: resolved.category.id,
    });
  }
  return { findings, setAside };
}

/** The round's intervention record, accepted or refused, from what the author proposed. */
export function interventionRecord(
  state: RunState,
  index: number,
  hypothesis: Hypothesis,
  plan: InterventionPlan,
  resolved: ResolvedFindings,
  refusal: string | null,
): Intervention {
  const stored = state.round(index);
  const earlier = state.ctx.store.interventions.get(state.ctx.runId, index);
  return {
    id: earlier?.id ?? newId('itv'),
    runId: state.ctx.runId,
    round: index,
    type: plan.type,
    title: hypothesis.title,
    hypothesis: plan.hypothesis.trim() || hypothesis.diagnosis,
    findings: resolved.findings,
    setAside: resolved.setAside,
    edits: hypothesis.edits,
    workedExamples: plan.workedExamples,
    practicePerFinding: plan.practicePerFinding,
    ...(plan.type === 'clarification' ? { question: plan.question } : {}),
    predicted: hypothesis.predicted,
    estimatedCost: plan.estimatedCost,
    verificationPlan: plan.verificationPlan,
    parent: {
      harnessVersion: stored.baseVersion,
      adapter: state.run.currentAdapter ?? null,
    },
    status: refusal === null ? 'accepted' : 'invalid',
    ...(refusal === null ? {} : { invalidReason: refusal }),
    createdAt: earlier?.createdAt ?? state.now(),
  };
}

/** The round's intervention, which the author step recorded before the round moved on. */
export function interventionOfRound(state: RunState, index: number): Intervention {
  return must(
    state.ctx.store.interventions.get(state.ctx.runId, index),
    `Round ${index}'s intervention`,
  );
}
