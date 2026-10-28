import {
  AdapterError,
  type ApprovalRequest,
  type ChatMessage,
  type Harness,
  type Trace,
  type TraceStep,
} from '@architect/shared';
import { runAgent } from '../agent/loop';
import { matchGuardrail } from '../agent/retrieval';
import { LocalRuntimeError, type GpuHold } from '../local-runtime';
import type { Sandbox } from '../sandbox/types';
import type { ApproveWrite } from '../tools/builtins';
import type { GraduateSession } from './graduate';
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
  let trace: Trace;
  let gpu: GpuHold | null = null;
  try {
    if (matchGuardrail(graduate.harness, input.request) === null) gpu = await input.holdGpu();
    trace = await runAgent({
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
      approveWrite: input.approveWrite,
      signal: input.signal,
    });
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
    reply.finish({
      status: 'error',
      error:
        error instanceof LocalRuntimeError
          ? `${error.message} ${error.hint}`
          : `It stopped on an unexpected problem: ${messageOf(error)}`,
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

function outcomeOf(trace: Trace): ReplyOutcome {
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
