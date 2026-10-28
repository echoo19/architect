import { createHash } from 'node:crypto';
import {
  AdapterError,
  VerifiedEpisodeSchema,
  type Experiment,
  type Finding,
  type GuardError,
  type Intervention,
  type Lesson,
  type LessonCost,
  type Task,
  type TeachingItem,
  type TeachingPlan,
} from '@architect/shared';
import { LeakRefusal } from '../mentor/gate';
import type { EngineStore } from '../store/engine-store';
import { gatedActor, refusalOf, type ActorCharge } from '../teaching/actor';
import type { CorrectionResult, CorrectionStart } from '../teaching/correction';
import { isAbort, must, passesOnItsOwn, summaryOf } from './errors';
import { writeJsonFile } from './files';
import { failedAttempts, interventionOfRound } from './intervene';
import type { RunState } from './run-state';
import { deriveSeed } from './seeds';

/** Verified lessons one category, and one task type, may hold in a run (spec section 6). */
export const MAX_LESSONS_PER_CATEGORY = 6;
export const MAX_LESSONS_PER_TYPE = 12;
/** Rounds without a dev gain after which a category's teaching stops; a task type's backstop. */
export const STOP_CATEGORY_AFTER = 2;
export const STOP_TYPE_AFTER = 4;
const MEASURED: ReadonlySet<Experiment['disposition']> = new Set(['kept', 'reverted', 'rejected']);

/** What a try that never produced a correction leaves: no checkpoint, check, audit or turns. */
const UNUSED: Omit<CorrectionResult, 'reason'> = {
  verified: false,
  checkpoint: null,
  check: null,
  audit: null,
  messages: [],
  actorTurns: [],
  tools: [],
  trace: null,
};

/** A pause, a stop or a spent wall clock: what ends teaching before its next correction. */
function teachingHalts(state: RunState): boolean {
  return (
    state.control.pauseRequested || state.record.stopRequested || state.budget.wallClockSpent()
  );
}

/**
 * An error from the mentor acting as the agent that waiting won't fix and that isn't shutdown:
 * a bad request, a content filter, a missing model. Errors that pass on their own still pause.
 */
function actorCantAct(state: RunState, error: unknown): error is AdapterError {
  if (state.signal.aborted || isAbort(error)) return false;
  return error instanceof AdapterError && !passesOnItsOwn(error);
}

/** A lesson's id: the same for the same try of the same item, so a retry can't add a second. */
export function lessonId(runId: string, round: number, item: number, attempt: number): string {
  const digest = createHash('sha256').update(`${runId}/${round}/${item}/${attempt}`).digest('hex');
  return `lsn_${digest.slice(0, 24)}`;
}

/**
 * Categories, and task types, whose teaching stopped: a category after two rounds that taught it
 * with no dev gain since its last one, and a task type after four, so a new slug for an old
 * failure doesn't start the count again.
 */
export function stoppedTeaching(state: RunState): { categories: Set<string>; types: Set<string> } {
  return stoppedFromRecords(state.ctx.store, state.ctx.runId);
}

/** `stoppedTeaching`, from a run's stored interventions and experiments. */
export function stoppedFromRecords(
  store: EngineStore,
  runId: string,
): { categories: Set<string>; types: Set<string> } {
  const interventions = new Map(store.interventions.list(runId).map((item) => [item.round, item]));
  const sinceGain = { categories: new Map<string, number>(), types: new Map<string, number>() };
  for (const experiment of store.experiments.list(runId)) {
    const intervention = interventions.get(experiment.round);
    if (!intervention || intervention.findings.length === 0) continue;
    const gained =
      experiment.disposition === 'kept' &&
      (experiment.devAfter?.pass ?? 0) > (experiment.devBefore?.pass ?? 0);
    // Only a measured round counts: one refused before it taught or measured anything doesn't.
    const counts = MEASURED.has(experiment.disposition);
    for (const [map, keys] of [
      [sinceGain.categories, intervention.findings.map((finding) => finding.categoryId)],
      [sinceGain.types, intervention.findings.map((finding) => finding.taskType)],
    ] as const) {
      for (const key of new Set(keys)) {
        if (gained) map.set(key, 0);
        else if (counts) map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
  }
  const over = (map: Map<string, number>, limit: number) =>
    new Set([...map].filter(([, count]) => count >= limit).map(([key]) => key));
  return {
    categories: over(sinceGain.categories, STOP_CATEGORY_AFTER),
    types: over(sinceGain.types, STOP_TYPE_AFTER),
  };
}

/** The task a lesson's request came from, when it came from one. */
function lessonTask(lesson: Lesson): string | null {
  return lesson.source.kind === 'correction' ? null : lesson.source.taskId;
}

/**
 * What a round will teach, fixed before the first correction so a restart follows the same plan:
 * a repair for each finding, then related practice from other train tasks of each finding's task
 * type, ranked by train-only counts (findings in the same category first, then failures). A task
 * taught earlier in the run isn't taught again, and the caps per category and per task type, and
 * a stopped category, set the rest aside with the reason.
 */
export async function planTeaching(
  state: RunState,
  intervention: Intervention,
): Promise<TeachingPlan> {
  const { store, runId } = state.ctx;
  const verified = store.lessons.list({ runId, status: 'verified' });
  const taught = new Set(verified.flatMap((lesson) => lessonTask(lesson) ?? []));
  const perCategory = new Map<string, number>();
  const perType = new Map<string, number>();
  for (const lesson of verified) {
    if (lesson.categoryId !== null) {
      perCategory.set(lesson.categoryId, (perCategory.get(lesson.categoryId) ?? 0) + 1);
    }
    perType.set(lesson.taskType, (perType.get(lesson.taskType) ?? 0) + 1);
  }
  const stopped = stoppedTeaching(state);
  const items: TeachingItem[] = [];
  const skipped: TeachingPlan['skipped'] = [];
  const planned = new Set<string>();
  const capped = (finding: Finding): string | null => {
    if ((perCategory.get(finding.categoryId) ?? 0) >= MAX_LESSONS_PER_CATEGORY) {
      return `its category already has ${MAX_LESSONS_PER_CATEGORY} verified lessons`;
    }
    if ((perType.get(finding.taskType) ?? 0) >= MAX_LESSONS_PER_TYPE) {
      return `its task type already has ${MAX_LESSONS_PER_TYPE} verified lessons`;
    }
    return null;
  };
  const count = (finding: Finding) => {
    perCategory.set(finding.categoryId, (perCategory.get(finding.categoryId) ?? 0) + 1);
    perType.set(finding.taskType, (perType.get(finding.taskType) ?? 0) + 1);
  };

  const taughtFindings: number[] = [];
  for (const [position, finding] of intervention.findings.entries()) {
    const what = `the repair of ${finding.taskId}`;
    if (stopped.categories.has(finding.categoryId)) {
      skipped.push({
        what,
        reason: `its category made no dev gain in ${STOP_CATEGORY_AFTER} rounds, so its teaching stopped`,
      });
    } else if (stopped.types.has(finding.taskType)) {
      skipped.push({
        what,
        reason: `its task type made no dev gain in ${STOP_TYPE_AFTER} rounds, so its teaching stopped`,
      });
    } else if (taught.has(finding.taskId)) {
      skipped.push({ what, reason: 'the task was taught in an earlier round' });
    } else {
      const cap = capped(finding);
      if (cap !== null) {
        skipped.push({ what, reason: cap });
        continue;
      }
      items.push({ kind: 'repair', finding: position });
      planned.add(finding.taskId);
      count(finding);
      taughtFindings.push(position);
    }
  }

  if (intervention.practicePerFinding > 0 && taughtFindings.length > 0) {
    const train = await state.trainTasks();
    const failures = new Map<string, number>();
    for (const attempt of state.attempts({ split: 'train' })) {
      if (!attempt.check.pass)
        failures.set(attempt.taskId, (failures.get(attempt.taskId) ?? 0) + 1);
    }
    const findingsIn = new Map<string, number>();
    for (const earlier of store.interventions.list(runId)) {
      for (const finding of earlier.findings) {
        const key = `${finding.categoryId}/${finding.taskId}`;
        findingsIn.set(key, (findingsIn.get(key) ?? 0) + 1);
      }
    }
    for (const position of taughtFindings) {
      const finding = must(intervention.findings[position], 'The finding');
      const candidates = train
        .filter(
          (task) =>
            task.type === finding.taskType &&
            !taught.has(task.id) &&
            !planned.has(task.id) &&
            task.family !== train.find((other) => other.id === finding.taskId)?.family,
        )
        .sort(
          (a, b) =>
            (findingsIn.get(`${finding.categoryId}/${b.id}`) ?? 0) -
              (findingsIn.get(`${finding.categoryId}/${a.id}`) ?? 0) ||
            (failures.get(b.id) ?? 0) - (failures.get(a.id) ?? 0) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      for (const task of candidates.slice(0, intervention.practicePerFinding)) {
        const cap = capped(finding);
        if (cap !== null) {
          skipped.push({ what: `practice on ${task.id}`, reason: cap });
          break;
        }
        items.push({ kind: 'practice', finding: position, taskId: task.id });
        planned.add(task.id);
        count(finding);
      }
    }
  }
  return { items, skipped };
}

/** Where a repair tries to start, in order: the suspected turn, one earlier, then the whole task. */
function ladder(finding: Finding): { start: 'checkpoint' | 'full_task'; turn: number }[] {
  const tries: { start: 'checkpoint' | 'full_task'; turn: number }[] = [];
  if (finding.failureTurn >= 2) tries.push({ start: 'checkpoint', turn: finding.failureTurn });
  if (finding.failureTurn - 1 >= 2) {
    tries.push({ start: 'checkpoint', turn: finding.failureTurn - 1 });
  }
  tries.push({ start: 'full_task', turn: 1 });
  return tries;
}

/** Charges one of the actor's calls to the round, the run and the cost ledger together. */
function chargeActor(state: RunState, index: number, charge: ActorCharge): void {
  const { store, runId } = state.ctx;
  const run = store.transaction(() => {
    const current = state.round(index);
    store.rounds.update({
      ...current,
      round: { ...current.round, costUsd: current.round.costUsd + charge.costUsd },
    });
    store.costs.insert({
      runId,
      role: 'mentor',
      model: charge.model,
      round: index,
      attemptId: null,
      usage: charge.usage,
      usd: charge.costUsd,
      at: state.now(),
    });
    return state.writeRun((current) => ({
      totals: {
        ...current.totals,
        mentorUsd: current.totals.mentorUsd + charge.costUsd,
        mentorInputTokens: current.totals.mentorInputTokens + charge.usage.inputTokens,
        mentorOutputTokens: current.totals.mentorOutputTokens + charge.usage.outputTokens,
      },
    }));
  });
  state.budget.recordSpend(charge.costUsd);
  state.emit({ type: 'run.updated', run });
  state.emitBudget();
}

interface Try {
  item: TeachingItem;
  position: number;
  attempt: number;
  task: Task;
  /** The finding a repair or practice item teaches; none for a one-shot demonstration. */
  finding: Finding | null;
  start: CorrectionStart;
  fallback: 'none' | 'earlier' | 'full_task';
}

/** What a lesson records beside the correction itself. */
interface LessonContext {
  intervention: Intervention;
  attempt: Try;
  cost: LessonCost;
  actorModel: string;
  /** The model the student ran as, for the episode's provenance. */
  studentModel: string;
  /** The incumbent's reasoning strength, as the chat template rendered it. */
  reasoningStrength: 'low' | 'medium' | 'high';
  /** The original data's hashes the correction started from, without their prefix. */
  inputHashes?: Record<string, string>;
}

/** A lesson from one correction: verified with its episode, or rejected with the reason. */
function lessonOf(state: RunState, context: LessonContext, result: CorrectionResult): Lesson {
  const { runId } = state.ctx;
  const { intervention, attempt, cost, actorModel, studentModel, inputHashes } = context;
  const { item, task, finding, start } = attempt;
  const id = lessonId(runId, intervention.round, attempt.position, attempt.attempt);
  // A one-shot demonstration is taught like practice: a whole train task, verified, never a repair.
  const kind =
    item.kind !== 'repair'
      ? 'practice'
      : start.kind === 'checkpoint'
        ? 'replay_correction'
        : 'full_task_demonstration';
  const category = finding === null ? null : state.ctx.store.categories.get(finding.categoryId);
  const firstActorTurn = result.actorTurns[0] ?? result.messages.length;
  const episode = result.verified
    ? VerifiedEpisodeSchema.parse({
        id,
        lessonId: id,
        kind,
        category: category?.slug ?? finding?.categoryId ?? task.type,
        origin: { kind: 'task', taskId: task.id, split: 'train' },
        messages: result.messages,
        tools: result.tools,
        verifiedTurns: result.actorTurns,
        check: must(result.check, 'The check of a verified correction'),
        template: {
          reasoningStrength: context.reasoningStrength,
          currentDate: state.record.today,
        },
        provenance: {
          jobId: state.run.jobId,
          runId,
          ...(item.kind === 'repair' && finding !== null ? { attemptId: finding.attemptId } : {}),
          harnessVersion: intervention.parent.harnessVersion,
          studentModel,
          mentorModel: actorModel,
          ...(kind === 'replay_correction' && result.checkpoint
            ? { replayFromStep: result.checkpoint.turn }
            : {}),
          ...(inputHashes === undefined ? {} : { inputHashes }),
          verifiedAt: state.now(),
        },
        sharing: { remoteTraining: state.job.sharing?.remoteTraining ?? false },
      })
    : null;
  return {
    id,
    jobId: state.run.jobId,
    runId,
    round: intervention.round,
    interventionId: intervention.id,
    status: result.verified ? 'verified' : 'rejected',
    reason: result.reason,
    kind,
    categoryId: finding?.categoryId ?? null,
    taskType: task.type,
    source:
      item.kind === 'repair' && finding !== null
        ? { kind: 'attempt', attemptId: finding.attemptId, taskId: task.id }
        : { kind: 'practice', taskId: task.id },
    ...(item.kind === 'repair' && finding !== null
      ? {
          diagnosis: {
            failureTurn: finding.failureTurn,
            cause: finding.cause,
            evidence: finding.evidence,
          },
        }
      : {}),
    checkpoint: {
      turn: start.kind === 'checkpoint' ? start.turn : 1,
      replayedCalls: result.checkpoint?.replayedCalls ?? 0,
      fallback: attempt.fallback,
    },
    check: result.check,
    audit: result.audit,
    turns: result.messages.slice(firstActorTurn),
    episode,
    actorModel,
    cost,
    createdAt: state.now(),
  };
}

/** Where each try of an item starts, and how far down the fallback ladder it is. */
function triesOf(
  item: TeachingItem,
  finding: Finding | null,
): { start: 'checkpoint' | 'full_task'; turn: number; fallback: Try['fallback'] }[] {
  if (item.kind !== 'repair' || finding === null) {
    return [{ start: 'full_task', turn: 1, fallback: 'none' }];
  }
  return ladder(finding).map((step, position) => ({
    ...step,
    fallback: position === 0 ? 'none' : step.start === 'full_task' ? 'full_task' : 'earlier',
  }));
}

/** A data hash as the episode's provenance holds it: the hex digest alone. */
function hexHashes(data: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([path, hash]) => [path, hash.replace(/^sha256-/, '')]),
  );
}

/** Ends the round for a guard's refusal of the actor: the budget, or the leak check. */
function endForRefusal(state: RunState, index: number, refusal: GuardError): void {
  const reason = `A correction's request was refused: ${refusal.message}`;
  if (refusal.guard === 'budget') state.closeRound(index, reason, 'usd');
  else if (refusal instanceof LeakRefusal || refusal.guard === 'split') {
    state.closeRound(index, reason, 'leak');
  } else state.closeRound(index, reason);
}

/** The model the student runs as on the endpoint the job trains on. */
function trainingStudentModel(state: RunState): string {
  const { student } = state.job;
  return student.trainOn === 'hosted' && student.hosted
    ? student.hosted.model
    : student.local.model;
}

/**
 * A round's teaching (decision 042): each planned item becomes a lesson, verified or rejected
 * with the reason. A repair resumes the failed attempt at the suspected turn; when that doesn't
 * verify, one checkpoint earlier, and then the whole task from the start, labelled as such. A
 * practice item is demonstrated from the start. Every try is recorded under an id fixed by the
 * round, the item and the try, so a restart picks up at the first try with no lesson and never
 * adds a second one. Resolves false when a guard refused a correction's request, which ends the
 * round; true once every item has its lesson.
 */
export async function teach(state: RunState, index: number): Promise<boolean> {
  state.setPhase('teaching');
  const { store, runId } = state.ctx;
  let intervention = interventionOfRound(state, index);
  if (intervention.teaching === undefined) {
    intervention = { ...intervention, teaching: await planTeaching(state, intervention) };
    store.interventions.put(intervention);
    state.announce('intervention', intervention.id, index);
  }
  const plan = must(intervention.teaching, 'The teaching plan');
  if (plan.items.length === 0) return true;

  const failed = await failedAttempts(state, index);
  const tasks = new Map((await state.trainTasks()).map((task) => [task.id, task]));
  const harness = await state.resources.harness(intervention.parent.harnessVersion);
  const raw = await state.resources.actor();
  const gate = await state.resources.gate();
  const sandbox = await state.resources.sandbox();
  const checker = await state.resources.checker();

  for (const [position, item] of plan.items.entries()) {
    const finding =
      item.kind === 'demonstration'
        ? null
        : must(intervention.findings[item.finding], 'The finding');
    const taskId = item.kind === 'repair' ? must(finding, 'The finding').taskId : item.taskId;
    const task = must(tasks.get(taskId), `Train task ${taskId}`);
    const source = item.kind === 'repair' ? failed.get(taskId) : undefined;
    for (const [attempt, step] of triesOf(item, finding).entries()) {
      const id = lessonId(runId, index, position, attempt);
      const prior = store.lessons.get(id);
      if (prior?.status === 'verified') break;
      if (prior) continue;
      // A pause, a stop or the wall clock ends teaching between corrections; the next session
      // resumes at this try, by its id.
      if (teachingHalts(state)) return false;
      const start: CorrectionStart =
        step.start === 'checkpoint'
          ? { kind: 'checkpoint', trace: must(source, 'The failed attempt').trace, turn: step.turn }
          : { kind: 'full_task' };
      const cost: LessonCost = { usd: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
      const actor = gatedActor(raw, gate, {
        onCharge: (charge) => {
          chargeActor(state, index, charge);
          cost.usd += charge.costUsd;
          cost.inputTokens += charge.usage.inputTokens;
          cost.outputTokens += charge.usage.outputTokens;
          cost.calls += 1;
        },
      });
      const replayed = source?.trace.replay;
      const context: LessonContext = {
        intervention,
        attempt: { item, position, attempt, task, finding, start, fallback: step.fallback },
        cost,
        actorModel: raw.model,
        studentModel: source ? source.trace.studentModel : trainingStudentModel(state),
        reasoningStrength: harness.decoding.thinking,
        ...(replayed === undefined ? {} : { inputHashes: hexHashes(replayed.data) }),
      };
      let result: CorrectionResult;
      try {
        result = await state.ctx.deps.runtime.correct(
          task,
          {
            job: state.job,
            jobDir: state.jobDir,
            harness,
            actor,
            sandbox,
            checker,
            today: state.record.today,
          },
          start,
          {
            seed: deriveSeed(state.record.seeds.mentor, `teach-${index}-${position}-${attempt}`),
            signal: state.signal,
          },
        );
      } catch (error) {
        const refusal = refusalOf(error);
        if (refusal === null) {
          if (!actorCantAct(state, error)) throw error;
          // The mentor can't act on this try (a bad request, a content filter, a missing
          // model): the try is kept as rejected with the reason, and teaching goes on.
          const failed = lessonOf(state, context, {
            ...UNUSED,
            reason: `The mentor couldn't act as the agent: ${summaryOf(error)}`,
          });
          store.lessons.put(failed);
          state.announce('lesson', failed.id, index);
          state.log(
            'warn',
            `Round ${index}: rejected a correction of ${task.id}. ${failed.reason}`,
          );
          continue;
        }
        const guard = refusal.guard === 'budget' ? 'mentor budget' : 'leak check';
        const refused = lessonOf(state, context, {
          ...UNUSED,
          reason: `The ${guard} refused the correction's request: ${refusal.message}`,
        });
        store.lessons.put(refused);
        state.announce('lesson', refused.id, index);
        endForRefusal(state, index, refusal);
        return false;
      }
      // A correction cut short by shutdown isn't a verdict; the try runs again on the next start.
      state.signal.throwIfAborted();
      const lesson = lessonOf(state, context, result);
      // What the mentor did as the agent, step by step, for playback beside the lesson: written
      // first, so a lesson on record always has the trace it was judged on.
      if (result.trace !== null) {
        await writeJsonFile(
          state.ctx.paths.traceFile(state.run.jobId, runId, lesson.id),
          result.trace,
        );
      }
      store.lessons.put(lesson);
      state.announce('lesson', lesson.id, index);
      state.log(
        lesson.status === 'verified' ? 'info' : 'warn',
        `Round ${index}: ${lesson.status} a correction of ${task.id}. ${lesson.reason}`,
      );
      if (lesson.status === 'verified') break;
    }
  }
  return true;
}
