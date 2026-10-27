import {
  AdapterError,
  GuardError,
  JsonValueSchema,
  TraceSchema,
  type Harness,
  type Hypothesis,
  type MentorAdapter,
  type MentorCompletionRequest,
} from '@architect/shared';
import type { GatedCompletion, MentorCharge } from '../mentor/gate';
import { diagnoseRequest, oneShotRequest, type PromptSettings } from '../mentor/prompts';
import { MentorReplyError, parseHypothesis } from '../mentor/reply';
import { studentAsMentor } from '../mentor/student-author';
import { buildMentorView, buildOneShotView, type TrainResult } from '../mentor/view';
import type { AuthorReply, StoredRound } from '../store/records';
import { HARNESS_VALIDATION_ERROR } from './deps';
import { errorMessage, must } from './errors';
import { readJsonFile, writeJsonFile } from './files';
import type { RunState } from './run-state';
import { roundSeed } from './seeds';

/** Replies that are the author's fault: the round ends without a change and training goes on. */
function isUnusableReply(error: unknown): boolean {
  return (
    error instanceof AdapterError && (error.code === 'bad_response' || error.code === 'blocked')
  );
}

/** A change set the harness won't take. The round ends without a change. */
function isRejectedChange(error: unknown): error is Error {
  return (
    error instanceof MentorReplyError ||
    (error instanceof GuardError && error.guard === 'harness_surface') ||
    (error instanceof Error && error.name === HARNESS_VALIDATION_ERROR)
  );
}

/** The mentor writes the hypotheses, except in self-reflection, where the student does. */
async function authorFor(state: RunState, index: number): Promise<MentorAdapter> {
  if (state.run.method !== 'self_reflection') return state.resources.mentor();
  const student = await state.resources.student(state.job.student.trainOn);
  return studentAsMentor(student, roundSeed(state.record.seeds.mentor, index));
}

function promptSettings(state: RunState): PromptSettings {
  const mentor = state.job.mentor;
  return {
    evaluation: state.job.evaluation,
    reasoningEffort:
      state.run.method !== 'self_reflection' && mentor.kind === 'model'
        ? mentor.reasoningEffort
        : undefined,
  };
}

/** Every file of a version, settings left at their defaults included, so the author sees them all. */
async function mentorFiles(state: RunState, version: number): Promise<Record<string, string>> {
  return state.ctx.deps.harness.harnessToFiles(await state.resources.harness(version), {
    includeDefaults: true,
  });
}

async function roundRequest(
  state: RunState,
  stored: StoredRound,
): Promise<MentorCompletionRequest> {
  const index = stored.round.index;
  const attempts = new Map(
    state
      .attempts({ split: 'train', round: index, version: stored.baseVersion })
      .map((attempt) => [attempt.taskId, attempt]),
  );
  const train: TrainResult[] = [];
  for (const task of await state.trainBatch(index)) {
    const attempt = must(attempts.get(task.id), `The train attempt at ${task.id}`);
    const tracePath = must(attempt.tracePath, `The trace of ${attempt.id}`);
    const trace = TraceSchema.parse(await readJsonFile(state.ctx.paths.fromStored(tracePath)));
    train.push({ task, pass: attempt.check.pass, reason: attempt.check.reason, trace });
  }
  const view = buildMentorView({
    job: state.job,
    dataFiles: await state.resources.dataFiles(),
    harnessFiles: await mentorFiles(state, stored.baseVersion),
    round: index,
    budgetLeft: state.budget.left(),
    train,
    dev: must(state.run.devCurrent, 'The dev score'),
    lineage: await state.lineage.read(),
  });
  return diagnoseRequest(view, promptSettings(state));
}

async function wholeHarnessRequest(state: RunState): Promise<MentorCompletionRequest> {
  const view = buildOneShotView({
    job: state.job,
    dataFiles: await state.resources.dataFiles(),
    harnessFiles: await mentorFiles(state, state.run.currentVersion),
    budgetLeft: state.budget.left(),
    train: await state.trainTasks(),
    devTotal: (await state.devTasks()).length,
  });
  return oneShotRequest(view, promptSettings(state));
}

/** Train task ids the author was shown, the only ones a hypothesis may cite as its cause. */
async function visibleTaskIds(state: RunState, index: number): Promise<Set<string>> {
  const tasks =
    state.run.method === 'one_shot' ? await state.trainTasks() : await state.trainBatch(index);
  return new Set(tasks.map((task) => task.id));
}

/**
 * Charges an author call to its round, the run and the cost ledger in one transaction, with
 * the reply when there is one. Failed calls the provider billed for are charged too.
 */
function charge(state: RunState, index: number, charged: MentorCharge, reply?: AuthorReply): void {
  const { store, runId } = state.ctx;
  const { model, usage, costUsd } = charged;
  const run = store.transaction(() => {
    const current = state.round(index);
    store.rounds.update({
      ...current,
      reply: reply ?? current.reply,
      round: { ...current.round, costUsd: current.round.costUsd + costUsd },
    });
    store.costs.insert({
      runId,
      role: 'mentor',
      model,
      round: index,
      attemptId: null,
      usage,
      usd: costUsd,
      at: state.now(),
    });
    return state.writeRun((current) => ({
      totals: {
        ...current.totals,
        mentorUsd: current.totals.mentorUsd + costUsd,
        mentorInputTokens: current.totals.mentorInputTokens + usage.inputTokens,
        mentorOutputTokens: current.totals.mentorOutputTokens + usage.outputTokens,
      },
    }));
  });
  state.budget.recordSpend(costUsd);
  state.emit({ type: 'mentor.finished', round: index, usage, costUsd });
  state.emit({ type: 'run.updated', run });
  state.emitBudget();
}

/** Asks the author for one hypothesis and records the reply; false when the round ended instead. */
async function requestHypothesis(state: RunState, index: number): Promise<boolean> {
  const request =
    state.run.method === 'one_shot'
      ? await wholeHarnessRequest(state)
      : await roundRequest(state, state.round(index));
  const author = await authorFor(state, index);
  const gate = await state.resources.gate();

  let gated: GatedCompletion;
  try {
    gated = await gate.complete(author, request, {
      signal: state.signal,
      onSend: () => state.emit({ type: 'mentor.started', round: index }),
      onSpent: (charged) => charge(state, index, charged),
    });
  } catch (error) {
    if (error instanceof GuardError && error.guard === 'budget') {
      state.closeRound(index, error.message, 'usd');
      return false;
    }
    if (error instanceof GuardError || isUnusableReply(error)) {
      state.closeRound(index, errorMessage(error));
      return false;
    }
    throw error;
  }

  const { completion, costUsd } = gated;
  const json = JsonValueSchema.safeParse(completion.json);
  const reply: AuthorReply = {
    text: completion.text,
    json: json.success ? json.data : undefined,
    usage: completion.usage,
    costUsd,
    model: completion.model,
    latencyMs: completion.latencyMs,
  };
  charge(state, index, { model: completion.model, usage: completion.usage, costUsd }, reply);
  await writeJsonFile(state.ctx.paths.mentorFile(state.run.jobId, state.ctx.runId, index), {
    request,
    reply,
  });
  return true;
}

/** Applies the recorded reply's change set to a new candidate version. */
async function adoptHypothesis(state: RunState, stored: StoredRound): Promise<void> {
  const index = stored.round.index;
  let hypothesis: Hypothesis;
  let candidate: Harness;
  try {
    hypothesis = parseHypothesis(
      must(stored.reply, 'The reply'),
      await visibleTaskIds(state, index),
    );
    candidate = state.ctx.deps.harness.applyEdits(
      await state.resources.harness(stored.baseVersion),
      hypothesis.edits,
    );
  } catch (error) {
    if (!isRejectedChange(error)) throw error;
    state.closeRound(index, error.message);
    return;
  }
  const saved = await state.versions.save(candidate, stored.baseVersion);
  state.saveRound({
    ...stored,
    hypothesis,
    round: {
      ...stored.round,
      status: 'evaluating',
      title: hypothesis.title,
      diagnosis: hypothesis.diagnosis,
      predicted: hypothesis.predicted,
      files: [...new Set(hypothesis.edits.map((edit) => edit.path))],
      candidateVersion: saved.meta.version,
    },
  });
}

/**
 * The author's step of a round: one hypothesis as a candidate version, or a round that ends
 * without a change. A reply already recorded before a restart is used, never paid for again.
 */
export async function author(state: RunState, index: number): Promise<void> {
  state.setPhase('diagnosing');
  if (state.round(index).reply === null && !(await requestHypothesis(state, index))) return;
  await adoptHypothesis(state, state.round(index));
}
