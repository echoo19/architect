import {
  AdapterError,
  type ApprovalRequest,
  type ChatMessage,
  type Harness,
  type Trace,
  type TraceStep,
} from '@architect/shared';
import { parseAnswerLine } from '../agent/answer';
import { runAgent } from '../agent/loop';
import { matchGuardrail } from '../agent/retrieval';
import { agreementSeeds, canonicalAnswer, vote } from '../certify/agreement';
import type { AgentFiles } from '../files/agent-files';
import { LocalRuntimeError, type GpuHold } from '../local-runtime';
import type { Sandbox } from '../sandbox/types';
import type { ApproveWrite } from '../tools/builtins';
import type { Agreement, GraduateSession } from './graduate';
import type { ReplyOutcome } from './messages';
import type { LiveReply } from './reply';
import { finishedStep, ruleSkillStep, startedStep, type NewStep } from './steps';

export interface ReplyRequest {
  graduate: GraduateSession;
  sandbox: Sandbox;
  reply: LiveReply;
  /** The user's message. */
  request: string;
  history: ChatMessage[];
  /** When the reply starts; the agent works as of its job's business date, or this day. */
  now: Date;
  /** A fresh sampler seed, so asking again can give a different answer. */
  seed: number;
  approveWrite: ApproveWrite;
  /** The approval a non-interactive reply needed and couldn't get, once it has asked. */
  approvalRequired(): ApprovalRequest | null;
  /**
   * Holds the GPU for the whole reply, in its turn (decision 046); null when the version's model
   * runs where Architect doesn't share the GPU out.
   */
  holdGpu(): Promise<GpuHold | null>;
  signal: AbortSignal;
}

/**
 * Runs the graduate on one message in chat mode and leaves its reply settled, whatever happens.
 * The reply first holds the GPU, waiting its turn when another of Architect's processes has it.
 * A refusal comes back from the runtime without the student being called, so it needs no GPU. An
 * error that isn't the model's or a tool's is shown on the reply and then thrown for the host to
 * report.
 */
export async function respond(input: ReplyRequest): Promise<void> {
  const { graduate, reply } = input;
  let trace: Settled;
  let gpu: GpuHold | null = null;
  const refused = matchGuardrail(graduate.harness, input.request) !== null;
  const { agreement } = graduate;
  const once = () =>
    runAgent({
      harness: graduate.harness,
      job: graduate.job,
      student: graduate.student,
      files: graduate.files,
      sandbox: input.sandbox,
      request: input.request,
      history: input.history,
      mode: 'chat',
      now: input.now,
      seed: input.seed,
      onStep: (step) => record(reply, graduate.harness, step),
      onText: (delta) => reply.appendText(delta),
      // A turn asked for again shows only its new text, so the chat never repeats itself.
      onRetract: () => reply.retract(),
      approveWrite: input.approveWrite,
      signal: input.signal,
    });
  // A certified version answers by agreement; a refusal needs no attempts.
  const answer = agreement === null || refused ? once : () => byAgreement(input, agreement);
  try {
    if (!refused) gpu = await input.holdGpu();
    // The reply's model turns run inside its hold, so each joins it rather than waiting in line.
    trace = gpu === null ? await answer() : await gpu.run(answer);
  } catch (error) {
    const approval = input.approvalRequired();
    if (approval !== null) {
      finishApprovalRequired(reply, approval);
      return;
    }
    // Stopped while it waited for the GPU: a stop, like one during the reply.
    if (input.signal.aborted && error instanceof AdapterError && error.code === 'aborted') {
      reply.finish({ status: 'stopped' });
      return;
    }
    // A local runtime's problem, such as a GPU that stayed busy, says what to do in its own words,
    // whether it came straight from the lease or through the student.
    const local =
      error instanceof LocalRuntimeError
        ? error
        : error instanceof AdapterError && error.cause instanceof LocalRuntimeError
          ? error.cause
          : null;
    reply.finish({
      status: 'error',
      error:
        local === null
          ? `It stopped on an unexpected problem: ${messageOf(error)}`
          : `${local.message} ${local.hint}`,
    });
    throw error;
  } finally {
    gpu?.release();
  }
  const approval = input.approvalRequired();
  if (approval !== null) {
    finishApprovalRequired(reply, approval);
    return;
  }
  if (trace.stopReason === 'max_steps') {
    const steps = graduate.harness.decoding.maxSteps;
    reply.addBlock({ kind: 'note', text: `Stopped after ${steps} steps without an answer.` });
  }
  reply.finish(outcomeOf(trace));
}

/** Ends a reply that needed an approval no one could give, with the change it wanted as data. */
function finishApprovalRequired(reply: LiveReply, approval: ApprovalRequest): void {
  reply.finish({
    status: 'error',
    error: `Stopped: ${approval.summary} needs your approval, and this run can't ask for it.`,
    failure: { kind: 'approval_required', approval },
  });
}

function record(reply: LiveReply, harness: Harness, step: TraceStep): void {
  reply.recordStep(step);
  switch (step.kind) {
    case 'model':
      reply.endTurn();
      for (const call of step.toolCalls) reply.addStep(startedStep(call, harness), call.id);
      return;
    case 'tool': {
      const finish = (started: NewStep) => finishedStep(started, step);
      if (!reply.finishCall(step.callId, finish)) {
        const call = { id: step.callId, name: step.name, arguments: step.arguments };
        reply.addStep(finish(startedStep(call, harness)));
      }
      return;
    }
    case 'skill':
      // A skill the model read already shows as the step of its read call.
      if (step.via === 'rule') reply.addStep(ruleSkillStep(step.slug));
      return;
    case 'refusal':
      reply.addBlock({ kind: 'refusal', taskType: step.taskType, reason: step.reason });
      return;
  }
}

/** How a reply's work ended: one attempt's trace, or what a certified reply settled on. */
type Settled = Pick<Trace, 'stopReason' | 'error'>;

/** One attempt of a certified reply, on its own copy of the files. */
interface Attempt {
  trace: Trace;
  files: AgentFiles;
  /** The canonical answer: its ANSWER line and its file changes (decision 077). */
  key: string;
}

/**
 * A certified version's reply (decision 077): k attempts at the request, each on its own copy of
 * the files and none shown as it runs, then the most common answer when at least the certified
 * number agree. Its steps are shown, and only its changes are proposed, each for approval as a
 * write would be. Otherwise the reply says it isn't sure and suggests a person take it. Each
 * attempt is a step, saying whether it agreed, so the disagreement can be looked at.
 */
async function byAgreement(input: ReplyRequest, agreement: Agreement): Promise<Settled> {
  const { graduate, reply } = input;
  const attempts: Attempt[] = [];
  for (const [index, seed] of agreementSeeds(input.seed, agreement.k).entries()) {
    const name = `Attempt ${index + 1} of ${agreement.k}`;
    reply.addStep({ kind: 'attempt', name, detail: name, status: 'running' }, `attempt-${index}`);
    const files = await graduate.scratchFiles();
    const trace = await runAgent({
      harness: graduate.harness,
      job: graduate.job,
      student: graduate.student,
      files,
      sandbox: input.sandbox,
      request: input.request,
      history: input.history,
      mode: 'chat',
      now: input.now,
      seed,
      signal: input.signal,
    });
    if (trace.stopReason === 'aborted' || trace.stopReason === 'error') return trace;
    const { answer } = parseAnswerLine(trace.finalText);
    attempts.push({
      trace,
      files,
      key: canonicalAnswer({ answer, stopReason: trace.stopReason }, trace.changes),
    });
  }
  const best = vote(attempts, (attempt) => attempt.key);
  const agreed = best !== null && best.votes >= agreement.votes;
  attempts.forEach((attempt, index) => {
    const same = attempt.key === best?.mode;
    reply.finishCall(`attempt-${index}`, (step) => ({
      ...step,
      detail: answerText(attempt.trace),
      meta: same ? 'agrees' : 'differs',
      status: 'done',
      ms: attempt.trace.latencyMs,
    }));
  });
  if (!agreed || best === null) {
    reply.appendText(
      `I'm not sure about this one: ${best?.votes ?? 0} of my ${agreement.k} attempts gave the same answer, and I answer only when at least ${agreement.votes} do. Please hand it to a person.`,
    );
    return { stopReason: 'answer' };
  }
  const chosen = best.chosen.trace;
  for (const step of chosen.steps) record(reply, graduate.harness, step);
  reply.appendText(chosen.finalText);
  await proposeChanges(input, best.chosen.files);
  return chosen;
}

/** The answer an attempt gave, in a few words, for its step. */
function answerText(trace: Trace): string {
  const { answer } = parseAnswerLine(trace.finalText);
  const changed = trace.changes?.length ?? 0;
  const said =
    answer !== null
      ? JSON.stringify(answer)
      : (trace.finalText.trim().split('\n')[0] ?? '').slice(0, 80) || 'No answer';
  return changed === 0 ? said : `${said}, ${changed} ${changed === 1 ? 'file' : 'files'} changed`;
}

/**
 * Proposes the chosen attempt's changes to the agent's own files, each file as one write the
 * person approves or declines, under the version's write mode. Nothing else is written.
 */
async function proposeChanges(input: ReplyRequest, chosen: AgentFiles): Promise<void> {
  const live = input.graduate.files;
  const before = live.texts();
  const after = chosen.texts();
  for (const path of Object.keys(after).sort()) {
    if (after[path] === before[path]) continue;
    const plan = live.plan('write', path, after[path] as string);
    if (!plan.changes) continue;
    const decision = await input.approveWrite(
      {
        tool: 'write',
        path: plan.path,
        summary: plan.summary,
        patch: plan.patch,
        ...(plan.rows === undefined ? {} : { rows: plan.rows }),
      },
      input.signal,
    );
    if (decision === 'approve') await live.apply(plan);
  }
}

function outcomeOf(trace: Settled): ReplyOutcome {
  switch (trace.stopReason) {
    case 'answer':
    case 'refused':
    case 'max_steps':
      return { status: 'done' };
    case 'aborted':
      return { status: 'stopped' };
    case 'error':
      return { status: 'error', error: trace.error ?? 'The model stopped with an error.' };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
