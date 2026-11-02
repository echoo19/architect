import {
  AdapterError,
  allowedInterventions,
  GuardError,
  HARNESS_INTERVENTIONS,
  interventionOf,
  JsonValueSchema,
  LEGACY_INTERVENTION,
  TraceSchema,
  type Harness,
  type Hypothesis,
  type MentorAdapter,
  type MentorCompletionRequest,
  type MentorView,
  type Probe,
  type Round,
} from '@architect/shared';
import {
  LeakRefusal,
  type GatedCompletion,
  type MentorCharge,
  type PayloadPart,
} from '../mentor/gate';
import { improvementLessons } from '../improve/improvement';
import {
  diagnoseRequest,
  oneShotRequest,
  proposeRequest,
  type PromptSettings,
} from '../mentor/prompts';
import { MentorReplyError, parseHypothesis, parseProposals } from '../mentor/reply';
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
import {
  counterexampleView,
  roundCounterexamples,
  suiteProblem,
  type FailedAttempt,
} from './counterexamples';
import { HARNESS_VALIDATION_ERROR } from './deps';
import { must } from './errors';
import { readJsonFile, writeJsonFile } from './files';
import { interventionRecord, resolveFindings } from './intervene';
import { answerTableProblem, orgFactsProblem } from './lookup';
import {
  changeSetRefusal,
  impliedKind,
  interventionRefusal,
  menuOf,
  roundMenu,
  type Menu,
} from './menu';
import { probeEvidence } from './probes';
import type { RunState } from './run-state';
import { roundSeed } from './seeds';
import { stoppedTeaching } from './teach';

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

const COMPOSED_HARNESS = 'A change composed from probes changes the harness, as its probes did.';

/**
 * The menu of a round's author. A change composed from probes (decision 108) is made from harness
 * changes measured as such, so it is a harness change too: weights and a question are off it.
 */
function composedMenu(menu: Menu, stored: StoredRound): Menu {
  if (stored.round.status !== 'composing') return menu;
  const refused: Menu['refused'] = { ...menu.refused };
  for (const type of ['weights', 'clarification'] as const) refused[type] ??= COMPOSED_HARNESS;
  const allowed = menu.allowed.filter((type) => HARNESS_INTERVENTIONS.includes(type));
  return { ...menu, allowed, refused };
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
    allowed: allowedInterventions(state.job),
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

/**
 * What the round's author sees: its train attempts, the harness, the dev score and the lineage,
 * and with the menu, its counterexamples and mentoring records. When the round composes from its
 * probes (decision 108), what each probe did as well.
 */
async function roundView(state: RunState, stored: StoredRound): Promise<MentorView> {
  const index = stored.round.index;
  const attempts = new Map(
    state
      .attempts({ split: 'train', round: index, version: stored.baseVersion })
      .map((attempt) => [attempt.taskId, attempt]),
  );
  const train: TrainResult[] = [];
  const failed: FailedAttempt[] = [];
  for (const task of await state.trainBatch(index)) {
    const attempt = must(attempts.get(task.id), `The train attempt at ${task.id}`);
    const tracePath = must(attempt.tracePath, `The trace of ${attempt.id}`);
    const trace = TraceSchema.parse(await readJsonFile(state.ctx.paths.fromStored(tracePath)));
    train.push({ task, pass: attempt.check.pass, reason: attempt.check.reason, trace });
    if (!attempt.check.pass) failed.push({ attemptId: attempt.id, task, trace });
  }
  const counterexamples = await roundCounterexamples(state, stored, failed);
  return buildMentorView({
    job: state.job,
    dataFiles: await state.resources.dataFiles(),
    harnessFiles: await mentorFiles(state, stored.baseVersion),
    round: index,
    budgetLeft: state.budget.left(),
    train,
    dev: must(state.run.devCurrent, 'The dev score'),
    lineage: await state.lineage.read(),
    rejected: rejectedRounds(state),
    ...(state.run.method === 'architect'
      ? {
          mentoring: await mentoringView(state, stored),
          counterexamples: counterexampleView(state, counterexamples),
        }
      : {}),
    ...(stored.round.status === 'composing' ? { probes: await probeEvidence(state, stored) } : {}),
  });
}

async function roundRequest(state: RunState, stored: StoredRound): Promise<AuthorRequest> {
  const view = await roundView(state, stored);
  return { request: diagnoseRequest(view, promptSettings(state)), parts: mentorViewParts(view) };
}

/** A propose-probe-compose round's first request: `count` alternatives for the same failures. */
async function proposalsRequest(
  state: RunState,
  index: number,
  count: number,
): Promise<AuthorRequest> {
  const view = await roundView(state, state.round(index));
  return {
    request: proposeRequest(view, promptSettings(state), count),
    parts: mentorViewParts(view),
  };
}

/**
 * What a mentor choosing from the menu sees beside the round's evidence: the menu, the job's
 * failure vocabulary with each category's verified lessons in this run and whether its teaching
 * stopped, and the person's answers to earlier questions. All of it from train and the person.
 */
async function mentoringView(
  state: RunState,
  stored: StoredRound,
): Promise<NonNullable<MentorView['mentoring']>> {
  const { store, runId } = state.ctx;
  const menu = composedMenu(await menuOf(state), stored);
  const stopped = stoppedTeaching(state);
  const verified = store.lessons.list({ runId, status: 'verified' });
  return {
    allowed: menu.allowed,
    refused: menu.refused,
    categories: store.categories.list(state.run.jobId).map((category) => ({
      id: category.id,
      slug: category.slug,
      label: category.label,
      taskType: category.taskType,
      verifiedLessons: verified.filter((lesson) => lesson.categoryId === category.id).length,
      stopped: stopped.categories.has(category.id) || stopped.types.has(category.taskType),
    })),
    answers: store.interventions
      .list(runId)
      .flatMap((intervention) =>
        intervention.question !== undefined && intervention.answer !== undefined
          ? [{ question: intervention.question, answer: intervention.answer.text }]
          : [],
      ),
    ...(state.record.improves === undefined
      ? {}
      : {
          lessons: improvementLessons(state).map(({ proposal, wrong, wanted }) => ({
            kind: proposal.kind,
            lesson: proposal.lesson,
            wrong,
            ...(wanted === undefined ? {} : { wanted }),
            ...(proposal.instruction === undefined ? {} : { instruction: proposal.instruction }),
            ...(proposal.taskType === undefined ? {} : { taskType: proposal.taskType }),
          })),
        }),
  };
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
 * Null when the round ended instead: out of budget, refused for a leak, or an unusable reply, or
 * when a stop or the time limit came first and nothing was sent.
 */
async function callAuthor(
  state: RunState,
  index: number,
  { request, parts }: AuthorRequest,
  fix: number,
  stage?: 'propose',
): Promise<AuthorReply | null> {
  // A stop or a spent clock ends the round before another call is paid for; the planner then
  // closes it, as it does any open round.
  if (state.record.stopRequested || state.budget.wallClockSpent()) return null;
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
    ...(stage === undefined ? {} : { stage }),
  };
  charge(state, index, { model: completion.model, usage: completion.usage, costUsd }, reply);
  const file = state.ctx.paths.mentorFile(state.run.jobId, state.ctx.runId, index, fix, stage);
  await writeJsonFile(file, { request, reply });
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
  original: AuthorRequest,
): Promise<boolean> {
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
  const fix = refused.fix + 1;
  return (await callAuthor(state, index, { request, parts }, fix, refused.stage)) !== null;
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
 * The candidate harness a change set makes, or why it can't: the harness refuses its files, a
 * tool it touches doesn't load, or it writes answers into the harness.
 */
async function candidateOf(
  state: RunState,
  stored: StoredRound,
  hypothesis: Hypothesis,
): Promise<{ harness: Harness } | { reason: string }> {
  // A first draft is held to the job's choice here too; no menu is asked about it.
  const barred = changeSetRefusal(changedFiles(hypothesis), state.job);
  if (barred !== null) return { reason: barred };
  let candidate: Harness;
  try {
    candidate = state.ctx.deps.harness.applyEdits(
      await state.resources.harness(stored.baseVersion),
      hypothesis.edits,
    );
  } catch (error) {
    if (!isRejectedChange(error)) throw error;
    return { reason: error.message };
  }
  const problem = await toolLoadProblem(state, candidate, hypothesis);
  if (problem !== null) return { reason: problem };
  if (!state.drafts(stored.round.index)) {
    const suite = await suiteProblem(state, stored, candidate, hypothesis);
    if (suite !== null) return { reason: suite };
  }
  if (!state.drafts(stored.round.index)) {
    const table = answerTableProblem(
      hypothesis.edits,
      await state.trainTasks(),
      (await state.resources.dataFiles()).map((file) => JSON.stringify(file)),
    );
    if (table !== null) return { reason: table };
    const facts = orgFactsProblem(hypothesis.edits, await state.resources.organizationTexts());
    if (facts !== null) return { reason: facts };
  }
  return { harness: candidate };
}

/**
 * Takes the recorded reply as the round's intervention (decision 042). Its findings are checked
 * against this round's failed attempts and its intervention against the menu and the budgets,
 * and the intervention is recorded, accepted or refused. A harness change with nothing to teach
 * becomes a candidate version at once; one that asks for worked examples or practice, and a
 * weights intervention, go to teaching first; a clarification waits for the person. Returns why
 * the reply can't be used, which gives the author its one fix.
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
  const drafting = state.drafts(index);
  const change = { named: hypothesis.intervention !== undefined, paths: changedFiles(hypothesis) };
  // A draft is a whole harness: whatever intervention its reply names, it is measured as one. A
  // reply that names none, such as a student's own, stands for the kind its files belong to.
  const plan = drafting
    ? LEGACY_INTERVENTION
    : change.named
      ? interventionOf(hypothesis)
      : { ...LEGACY_INTERVENTION, type: impliedKind(change.paths, state.job) };
  const menu = drafting ? null : composedMenu(await roundMenu(state), stored);
  const resolved =
    drafting || hypothesis.findings === undefined
      ? { findings: [], setAside: [] }
      : await resolveFindings(state, index, hypothesis.findings);
  let refusal =
    menu === null ? null : interventionRefusal(plan, resolved.findings.length, state, menu, change);
  let candidate: Harness | null = null;
  if (refusal === null && HARNESS_INTERVENTIONS.includes(plan.type)) {
    const built = await candidateOf(state, stored, hypothesis);
    if ('reason' in built) refusal = built.reason;
    else candidate = built.harness;
  }
  const intervention = drafting
    ? null
    : interventionRecord(state, index, hypothesis, plan, resolved, refusal);
  if (refusal !== null) {
    if (intervention) {
      state.ctx.store.interventions.put(intervention);
      state.announce('intervention', intervention.id, index);
    }
    return { reason: refusal, proposal: proposalOf(hypothesis) };
  }

  const teaches =
    plan.type === 'weights' ||
    (resolved.findings.length > 0 &&
      (plan.workedExamples.length > 0 || plan.practicePerFinding > 0));
  const saved =
    candidate !== null && !teaches
      ? await state.versions.save(candidate, stored.baseVersion)
      : null;
  const status: Round['status'] =
    plan.type === 'clarification' ? 'clarifying' : teaches ? 'teaching' : 'evaluating';
  const round: Round = {
    ...stored.round,
    status,
    title: hypothesis.title,
    diagnosis: hypothesis.diagnosis,
    predicted: hypothesis.predicted,
    files: changedFiles(hypothesis),
    ...(saved === null ? {} : { candidateVersion: saved.meta.version }),
  };
  state.ctx.store.transaction(() => {
    if (intervention) state.ctx.store.interventions.put(intervention);
    state.ctx.store.rounds.update({ ...stored, hypothesis, round });
  });
  state.emit({ type: 'round.updated', round });
  if (intervention) state.announce('intervention', intervention.id, index);
  if (status === 'clarifying') {
    // The run parks until the person answers; its phase says what it waits for.
    state.setPhase('clarifying');
    state.log('info', `Round ${index}: the mentor has a question for you. ${plan.question}`);
  }
  return null;
}

/**
 * A propose-probe-compose round's proposals as its probes (decision 108). Each is held to the
 * same checks as any change set: this round's menu, the harness, its tools loading, the helpers'
 * counterexamples, and no answers or one organization's facts in the harness. One that fails them,
 * or repeats an earlier one, is refused with the reason and never measured; the others are saved
 * as versions, and the round goes on to measure them. Returns why the reply can't be used: it
 * isn't a list of proposals, or not one of them can be measured.
 */
async function adoptProposals(
  state: RunState,
  stored: StoredRound,
  count: number,
): Promise<Unusable | null> {
  const index = stored.round.index;
  let proposals: Hypothesis[];
  try {
    proposals = parseProposals(
      must(stored.reply, 'The reply'),
      await visibleTaskIds(state, index),
      count,
    );
  } catch (error) {
    if (!(error instanceof MentorReplyError)) throw error;
    return { reason: error.message, proposal: {} };
  }
  const menu = await roundMenu(state);
  // The versions a restart left on the round, read before this pass writes over them.
  const earlier = stored.round.probes ?? [];
  const seen = new Map<string, number>();
  const probes: Probe[] = [];
  for (const [position, hypothesis] of proposals.entries()) {
    const probe: Probe = {
      index: position + 1,
      title: hypothesis.title,
      diagnosis: hypothesis.diagnosis,
      files: changedFiles(hypothesis),
      predicted: hypothesis.predicted,
    };
    const key = JSON.stringify(hypothesis.edits);
    const same = seen.get(key);
    let refusal =
      same === undefined
        ? changeSetRefusal(probe.files, state.job, menu)
        : `The same change set as probe ${same}.`;
    if (refusal === null) {
      const candidate = await candidateOf(state, stored, hypothesis);
      if (!('reason' in candidate)) {
        const version = await probeVersion(state, stored, earlier, probe.index, candidate.harness);
        seen.set(key, probe.index);
        probes.push({ ...probe, version });
        // Each version is on the round as soon as it is saved, so a restart reuses it.
        const current = state.round(index);
        state.saveRound({ ...current, round: { ...current.round, probes: [...probes] } });
        continue;
      }
      refusal = candidate.reason;
    }
    probes.push({ ...probe, refused: refusal });
  }
  if (probes.every((probe) => probe.version === undefined)) {
    const reasons = probes.map((probe) => `Proposal ${probe.index}: ${probe.refused ?? ''}`);
    return { reason: `No proposal could be measured. ${reasons.join(' ')}`, proposal: {} };
  }
  const current = state.round(index);
  state.saveRound({ ...current, round: { ...current.round, status: 'probing', probes } });
  return null;
}

/**
 * The version a probe is saved as: the one a restart left on the round for this proposal when it
 * holds the same files, so a proposal is never saved twice, or else a new one from the incumbent.
 */
async function probeVersion(
  state: RunState,
  stored: StoredRound,
  earlier: readonly Probe[],
  position: number,
  harness: Harness,
): Promise<number> {
  const saved = earlier.find((probe) => probe.index === position)?.version;
  if (saved !== undefined) {
    const { harnessToFiles } = state.ctx.deps.harness;
    const files = harnessToFiles(await state.resources.harness(saved));
    if (JSON.stringify(files) === JSON.stringify(harnessToFiles(harness))) return saved;
  }
  return (await state.versions.save(harness, stored.baseVersion)).meta.version;
}

/**
 * A propose-probe-compose round's first step (decision 108): the author's alternatives, saved as
 * probes for the runner to measure. A reply the runner can't use goes back once with the reason,
 * as any reply does; if the fix can't be used either, the round is rejected.
 */
async function propose(state: RunState, index: number, count: number): Promise<void> {
  const ask = () => proposalsRequest(state, index, count);
  if (state.round(index).reply === null) {
    if ((await callAuthor(state, index, await ask(), 0, 'propose')) === null) return;
  }
  for (;;) {
    const stored = state.round(index);
    const unusable = await adoptProposals(state, stored, count);
    if (unusable === null) return;
    const reply = must(stored.reply, 'The reply');
    if (reply.fix >= MAX_FIXES) {
      state.rejectRound(index, unusable.reason, unusable.proposal);
      return;
    }
    state.log(
      'info',
      `Round ${index}: the runner couldn't use the proposals, so the author gets one fix. ${unusable.reason}`,
    );
    if (!(await requestFix(state, index, reply, unusable.reason, await ask()))) return;
  }
}

/**
 * The author's step of a round: one hypothesis as a candidate version, or a round that ends
 * without a change. A reply the runner can't use goes back to the author once, with the reason;
 * if the fix can't be used either, the round is rejected. A reply already recorded before a
 * restart is used, never paid for again. A propose-probe-compose round (decision 108) comes here
 * twice: first for its proposals, then, once they are measured, to compose its one change from
 * them, which then goes on as any round's change does.
 */
export async function author(state: RunState, index: number): Promise<void> {
  state.setPhase('diagnosing');
  const count = state.probeCount(index);
  if (count !== null && state.round(index).round.status !== 'composing') {
    await propose(state, index, count);
    return;
  }
  // A composing round holds its proposals' reply until the composed change's reply replaces it.
  const recorded = state.round(index).reply;
  if (recorded === null || recorded.stage === 'propose') {
    if (!(await requestHypothesis(state, index))) return;
  }
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
    if (
      !(await requestFix(state, index, reply, unusable.reason, await buildRequest(state, index)))
    ) {
      return;
    }
  }
}
