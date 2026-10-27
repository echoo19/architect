import {
  AdapterError,
  GuardError,
  JsonValueSchema,
  TraceSchema,
  type Harness,
  type Hypothesis,
  type MentorAdapter,
  type MentorCompletionRequest,
  type Round,
} from '@architect/shared';
import {
  LeakRefusal,
  type GatedCompletion,
  type MentorCharge,
  type PayloadPart,
} from '../mentor/gate';
import { diagnoseRequest, oneShotRequest, type PromptSettings } from '../mentor/prompts';
import { MentorReplyError, parseHypothesis } from '../mentor/reply';
import { studentAsMentor } from '../mentor/student-author';
import {
  buildMentorView,
  buildOneShotView,
  mentorViewParts,
  oneShotViewParts,
  type RejectedRound,
  type TrainResult,
} from '../mentor/view';
import type { AuthorReply, StoredRound } from '../store/records';
import { HARNESS_VALIDATION_ERROR } from './deps';
import { must } from './errors';
import { readJsonFile, writeJsonFile } from './files';
import type { RunState } from './run-state';
import { roundSeed } from './seeds';

/**
 * How many times the author may fix a reply the runner couldn't use, before its round is
 * rejected (decision 023).
 */
const MAX_FIXES = 1;

const FIX_NOT_SENT =
  "The request to fix the reply couldn't be sent, so the round ended without a change.";

/** Replies that are the author's fault: the round is rejected and training goes on. */
function isUnusableReply(error: unknown): error is AdapterError {
  return (
    error instanceof AdapterError && (error.code === 'bad_response' || error.code === 'blocked')
  );
}

/** A change set the harness won't take: the round is rejected and training goes on. */
function isRejectedChange(error: unknown): error is Error {
  return (
    (error instanceof GuardError && error.guard === 'harness_surface') ||
    (error instanceof Error && error.name === HARNESS_VALIDATION_ERROR)
  );
}

/** Earlier rounds the runner rejected, with their reasons, for the author to learn from. */
function rejectedRounds(state: RunState): RejectedRound[] {
  return state
    .rounds()
    .filter(({ rejected }) => rejected)
    .map(({ round }) => ({
      round: round.index,
      title: round.title,
      files: round.files,
      reason: must(round.error, `The reason round ${round.index} was rejected`),
    }));
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

/** A request for the author, with its payload in parts so a leak refusal can name its source. */
interface AuthorRequest {
  request: MentorCompletionRequest;
  parts: PayloadPart[];
}

async function roundRequest(state: RunState, stored: StoredRound): Promise<AuthorRequest> {
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
    rejected: rejectedRounds(state),
  });
  return { request: diagnoseRequest(view, promptSettings(state)), parts: mentorViewParts(view) };
}

async function wholeHarnessRequest(state: RunState): Promise<AuthorRequest> {
  const refinedLater = state.run.method !== 'one_shot';
  const view = buildOneShotView({
    job: state.job,
    dataFiles: await state.resources.dataFiles(),
    harnessFiles: await mentorFiles(state, state.run.currentVersion),
    budgetLeft: state.budget.left(),
    train: await state.trainTasks(),
    devTotal: (await state.devTasks()).length,
  });
  return {
    request: oneShotRequest(view, promptSettings(state), refinedLater),
    parts: oneShotViewParts(view),
  };
}

/** Train task ids the author was shown, the only ones a hypothesis may cite as its cause. */
async function visibleTaskIds(state: RunState, index: number): Promise<Set<string>> {
  const tasks = state.drafts(index) ? await state.trainTasks() : await state.trainBatch(index);
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

/** What the round's author is asked: the whole harness for one-shot, otherwise one hypothesis. */
async function buildRequest(state: RunState, index: number): Promise<AuthorRequest> {
  return state.drafts(index) ? wholeHarnessRequest(state) : roundRequest(state, state.round(index));
}

/**
 * Sends a request to the round's author through the gate, and records and charges the reply.
 * Null when the round ended instead: out of budget, refused for a leak, or an unusable reply.
 */
async function callAuthor(
  state: RunState,
  index: number,
  { request, parts }: AuthorRequest,
  fix: number,
): Promise<AuthorReply | null> {
  const author = await authorFor(state, index);
  const gate = await state.resources.gate();

  let gated: GatedCompletion;
  try {
    gated = await gate.complete(author, request, {
      signal: state.signal,
      parts,
      onSend: () => state.emit({ type: 'mentor.started', round: index }),
      onSpent: (charged) => charge(state, index, charged),
    });
  } catch (error) {
    if (error instanceof GuardError && error.guard === 'budget') {
      state.closeRound(index, error.message, 'usd');
      return null;
    }
    if (error instanceof LeakRefusal) {
      // A fix adds only the author's own refused reply, which was never applied, so only its
      // round ends, with a reason that says nothing about the locked test. Any other payload
      // would be built again from the same data next round and refused again.
      if (fix > 0) state.rejectRound(index, FIX_NOT_SENT);
      else state.closeRound(index, error.message, 'leak');
      return null;
    }
    if (isUnusableReply(error)) {
      state.rejectRound(index, error.message);
      return null;
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
    fix,
  };
  charge(state, index, { model: completion.model, usage: completion.usage, costUsd }, reply);
  await writeJsonFile(state.ctx.paths.mentorFile(state.run.jobId, state.ctx.runId, index, fix), {
    request,
    reply,
  });
  return reply;
}

/** Asks the author for one hypothesis and records the reply; false when the round ended instead. */
async function requestHypothesis(state: RunState, index: number): Promise<boolean> {
  return (await callAuthor(state, index, await buildRequest(state, index), 0)) !== null;
}

/**
 * Asks the author to fix a reply the runner couldn't use: the same request, followed by that
 * reply and the reason it was refused. Nothing else is added, so a fix can repair a format but
 * learns nothing about how the student did (decision 023).
 */
async function requestFix(
  state: RunState,
  index: number,
  refused: AuthorReply,
  reason: string,
): Promise<boolean> {
  const original = await buildRequest(state, index);
  const note = [
    `The runner couldn't use that reply, so nothing was applied. ${reason}`,
    'Reply again with the whole JSON object, changing only what these problems need.',
  ].join('\n\n');
  const request: MentorCompletionRequest = {
    ...original.request,
    messages: [
      ...original.request.messages,
      { role: 'assistant', content: refused.text },
      { role: 'user', content: note },
    ],
  };
  const parts: PayloadPart[] = [
    ...original.parts,
    { label: "the author's refused reply", text: refused.text },
    { label: 'the reason it was refused', text: reason },
  ];
  return (await callAuthor(state, index, { request, parts }, refused.fix + 1)) !== null;
}

function changedFiles(hypothesis: Hypothesis): string[] {
  return [...new Set(hypothesis.edits.map((edit) => edit.path))];
}

function proposalOf(hypothesis: Hypothesis): Unusable['proposal'] {
  return {
    title: hypothesis.title,
    diagnosis: hypothesis.diagnosis,
    files: changedFiles(hypothesis),
  };
}

/**
 * Why a tool the change set added or edited doesn't load in the sandbox, such as a syntax error,
 * or null when they all load. Only the code's top level runs; no tool is called (decision 025).
 */
async function toolLoadProblem(
  state: RunState,
  candidate: Harness,
  hypothesis: Hypothesis,
): Promise<string | null> {
  const touched = new Set(hypothesis.edits.map((edit) => edit.path));
  const sandbox = await state.resources.sandbox();
  for (const tool of candidate.tools) {
    if (!touched.has(`tools/${tool.name}.js`) && !touched.has(`tools/${tool.name}.json`)) continue;
    const problem = await state.ctx.deps.runtime.toolLoadProblem(sandbox, tool);
    if (problem !== null) return `tools/${tool.name}.js doesn't load: ${problem}`;
  }
  return null;
}

/** Why a recorded reply can't become a candidate, and what it proposed, for its rejection. */
interface Unusable {
  reason: string;
  proposal: Partial<Pick<Round, 'title' | 'diagnosis' | 'files'>>;
}

/**
 * Applies the recorded reply's change set to a new candidate version. Returns why it couldn't
 * when the reply isn't a hypothesis or the harness won't take its change set.
 */
async function adoptHypothesis(state: RunState, stored: StoredRound): Promise<Unusable | null> {
  const index = stored.round.index;
  let hypothesis: Hypothesis;
  try {
    hypothesis = parseHypothesis(
      must(stored.reply, 'The reply'),
      await visibleTaskIds(state, index),
    );
  } catch (error) {
    if (!(error instanceof MentorReplyError)) throw error;
    return { reason: error.message, proposal: {} };
  }
  let candidate: Harness;
  try {
    candidate = state.ctx.deps.harness.applyEdits(
      await state.resources.harness(stored.baseVersion),
      hypothesis.edits,
    );
  } catch (error) {
    if (!isRejectedChange(error)) throw error;
    return { reason: error.message, proposal: proposalOf(hypothesis) };
  }
  const problem = await toolLoadProblem(state, candidate, hypothesis);
  if (problem !== null) return { reason: problem, proposal: proposalOf(hypothesis) };
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
      files: changedFiles(hypothesis),
      candidateVersion: saved.meta.version,
    },
  });
  return null;
}

/**
 * The author's step of a round: one hypothesis as a candidate version, or a round that ends
 * without a change. A reply the runner can't use goes back to the author once, with the reason;
 * if the fix can't be used either, the round is rejected. A reply already recorded before a
 * restart is used, never paid for again.
 */
export async function author(state: RunState, index: number): Promise<void> {
  state.setPhase('diagnosing');
  if (state.round(index).reply === null && !(await requestHypothesis(state, index))) return;
  for (;;) {
    const stored = state.round(index);
    const unusable = await adoptHypothesis(state, stored);
    if (unusable === null) return;
    const reply = must(stored.reply, 'The reply');
    if (reply.fix >= MAX_FIXES) {
      state.rejectRound(index, unusable.reason, unusable.proposal);
      return;
    }
    state.log(
      'info',
      `Round ${index}: the runner couldn't use the reply, so the author gets one fix. ${unusable.reason}`,
    );
    if (!(await requestFix(state, index, reply, unusable.reason))) return;
  }
}
