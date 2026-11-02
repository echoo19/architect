import {
  AdapterError,
  ASK_TEAMMATE,
  LeafStepSchema,
  MAX_CONSULTATIONS,
  TEAM_REQUEST_CHARS,
  type ConsultationOutcome,
  type LeafStep,
  type ReplyStep,
  type Trace,
} from '@architect/shared';
import { parseAnswerLine } from '../agent/answer';
import { runAgent } from '../agent/loop';
import { gaveAnswer } from '../certify/agreement';
import {
  LocalRuntimeError,
  replyPurpose,
  type GpuHold,
  type GpuLease,
  type GpuUse,
  type GpuWatch,
} from '../local-runtime';
import type { Sandbox } from '../sandbox/types';
import type { ApproveWrite } from '../tools/builtins';
import { ToolError } from '../tools/errors';
import type { ExtraTool } from '../tools/toolbox';
import type { GraduateSession } from './graduate';
import { replyStep, type LiveReply } from './reply';
import { toolsTried } from './respond';
import { showStep, type NewStep, type StepList, type Teammates } from './steps';

/** Sampler seeds stay within a signed 32-bit integer, which every runtime accepts. */
const SEED_LIMIT = 2 ** 31;

/**
 * A tool call the model wrote out as text, such as `<atem:invoke name="read">` or a stray
 * `<atem:parameter name="path">`, which no runtime ran. It is not an answer for the lead to read.
 */
const WRITTEN_CALL = /<\/?[a-z][\w-]*:(?:function_calls|invoke|parameter)(?=[\s/>])/i;

/** What a team's lead is told about when to ask, in its system prompt, in team replies only. */
export const TEAM_INSTRUCTION = `You work in a team. When a request names something your files don't have, or needs work your teammates' files cover, ask that teammate with ${ASK_TEAMMATE} first, and say exactly what you need back from it, such as the list or the records you will work from.`;

/** A teammate as one reply has it: the session it opened with and what the lead may ask it. */
export interface Teammate {
  session: GraduateSession;
  /** The team's line on what to ask it, or its contract's summary when the team gives none. */
  role: string;
}

export interface TeamReplyOptions {
  lead: GraduateSession;
  /** The lead's teammates, as the reply began: each opened, and kept until the reply ends. */
  teammates: readonly Teammate[];
  sandbox: Sandbox;
  reply: LiveReply;
  /** When the reply started; each teammate works as of its own job's date, or this day. */
  now: Date;
  /** The reply's seed, from which each consultation's own is taken. */
  seed: number;
  gpu: GpuLease;
  /** What the lead's model turns hold of the GPU, and its hold once it has one. */
  leadUse: GpuUse | null;
  leadHold(): GpuHold | null;
  /** Hears who a teammate waits for when another process has the GPU. */
  watch: GpuWatch;
  /**
   * A teammate's writes, each asked under its own write mode and name; `pause` lets every hold
   * of the GPU go while the person decides, as a lead's approval does.
   */
  approveWrite(teammate: Teammate, pause: () => void): ApproveWrite;
  signal: AbortSignal;
}

/** How a consultation ended, and what the lead is told. */
interface Settled {
  outcome: ConsultationOutcome;
  text: string;
}

/**
 * The teammates of a team reply (decision 100), by the name the lead asks for, for the steps
 * that show each consultation.
 */
export function teammatesOf(teammates: readonly Teammate[]): Teammates {
  const byName = new Map(teammates.map((teammate) => [teammate.session.name, teammate.session]));
  return (name) => {
    const session = byName.get(name.trim());
    return session && { graduateId: session.id, name: session.name, version: session.version };
  };
}

/**
 * The tool a lead asks its teammates with, offered only in a team reply. Each ask runs the
 * teammate once, in task mode, on its own files and the request as the lead wrote it, with no
 * conversation: only text crosses. A teammate can't ask anyone in turn. Its writes are asked
 * under its own name and mode, its steps show inside the consultation as they happen, and its
 * work is kept with the reply as it goes, so a stop or a restart leaves it settled.
 */
export function askTeammate(options: TeamReplyOptions): ExtraTool {
  const { lead, teammates, reply } = options;
  const names = teammates.map((teammate) => teammate.session.name);
  const byName = new Map(teammates.map((teammate) => [teammate.session.name, teammate]));
  let asked = 0;

  const lines = teammates.map(({ session, role }) => {
    const skills = session.about.skills.join(', ');
    const files = session.about.files.join(', ');
    const said = /[.!?]$/.test(role) ? role : `${role}.`;
    return `- ${session.name}: ${said}${skills === '' ? '' : ` It handles: ${skills}.`}${files === '' ? '' : ` Its files: ${files}.`}`;
  });

  async function consult(teammate: Teammate, request: string, callId: string): Promise<string> {
    const { session } = teammate;
    const { signal } = options;
    const steps = new TeammateSteps();
    const work: ReplyStep[] = [];
    const record = (settled?: Settled) => {
      reply.updateCall(callId, (step) =>
        step.view?.kind === 'consult'
          ? {
              ...step,
              view: {
                ...step.view,
                steps: [...steps.steps],
                ...(settled === undefined ? {} : { outcome: settled.outcome }),
              },
            }
          : step,
      );
      reply.recordConsultation(callId, {
        graduateId: session.id,
        version: session.version,
        request,
        work: [...work],
        text: settled?.text ?? '',
        ...(settled === undefined ? {} : { outcome: settled.outcome }),
      });
    };
    record();

    let hold: GpuHold | null = null;
    const pause = () => {
      hold?.pause();
      options.leadHold()?.pause();
    };
    const run = () =>
      runAgent({
        harness: session.harness,
        job: session.job,
        student: session.student,
        files: session.files,
        sandbox: options.sandbox,
        request,
        mode: 'task',
        now: options.now,
        seed: (options.seed + asked) % SEED_LIMIT,
        onStep: (step) => {
          work.push(replyStep(step));
          showStep(steps, session.harness, step);
          record();
        },
        // Always given: without it, a write would go straight to the teammate's file.
        approveWrite: options.approveWrite(teammate, pause),
        signal,
      });
    let settled: Settled;
    try {
      hold = await holdGpu(session);
      settled = settledAs(session, hold === null ? await run() : await hold.run(run));
    } catch (error) {
      const local = localProblem(error);
      if (signal.aborted) settled = { outcome: 'stopped', text: stoppedText(session) };
      else if (local !== null) {
        settled = { outcome: 'error', text: `${session.name} couldn't answer. ${local}` };
      } else {
        record({ outcome: 'error', text: `${session.name} stopped on an unexpected problem.` });
        throw error;
      }
    } finally {
      hold?.release();
    }
    record(settled);
    return settled.text;
  }

  /**
   * The teammate's hold of the GPU for all its turns. On the lead's runtime it joins the lead's
   * hold; on the other one the lead's hold goes first, so the two never wait on each other, and
   * the lead's next model turn takes it back.
   */
  async function holdGpu(session: GraduateSession): Promise<GpuHold | null> {
    if (session.gpu === null) return null;
    if (session.gpu !== options.leadUse) options.leadHold()?.pause();
    return options.gpu.hold(session.gpu, replyPurpose(session.name), options.signal, options.watch);
  }

  return {
    instruction: TEAM_INSTRUCTION,
    spec: {
      name: ASK_TEAMMATE,
      description: [
        "Ask a teammate to do part of the request. Each works only on its own files, which you can't read, and doesn't see this conversation, so say everything it needs. Your teammates:",
        ...lines,
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          member: { type: 'string', enum: names, description: 'The teammate to ask.' },
          request: {
            type: 'string',
            maxLength: TEAM_REQUEST_CHARS,
            description: 'What to ask it, with everything it needs to know.',
          },
        },
        required: ['member', 'request'],
        additionalProperties: false,
      },
    },
    async run(call) {
      const { member, request } = call.arguments;
      const teammate = typeof member === 'string' ? byName.get(member.trim()) : undefined;
      if (teammate === undefined) {
        const who =
          typeof member === 'string' && member.trim() === lead.name
            ? `You are ${lead.name}.`
            : `There is no teammate called "${typeof member === 'string' ? member : ''}".`;
        throw new ToolError(`${who} Ask one of your teammates: ${names.join(', ')}.`);
      }
      const text = typeof request === 'string' ? request.trim() : '';
      // The step shows a consultation already. One refused here is kept as that error, with
      // whom it named, so the chat still says whose words are in it.
      const refuse = (message: string): never => {
        reply.updateCall(call.id, (step) =>
          step.view?.kind === 'consult'
            ? { ...step, view: { ...step.view, outcome: 'error' } }
            : step,
        );
        reply.recordConsultation(call.id, {
          graduateId: teammate.session.id,
          version: teammate.session.version,
          request: text,
          work: [],
          text: message,
          outcome: 'error',
        });
        throw new ToolError(message);
      };
      if (text === '') refuse(`Say what to ask ${teammate.session.name}.`);
      if (text.length > TEAM_REQUEST_CHARS) {
        refuse(
          `A request to a teammate may be at most ${TEAM_REQUEST_CHARS} characters; this one is ${text.length}. Ask for less at a time.`,
        );
      }
      if (asked >= MAX_CONSULTATIONS) {
        refuse(
          `You have asked your teammates ${MAX_CONSULTATIONS} times in this reply, the most one reply may. Answer with what you have.`,
        );
      }
      asked += 1;
      return { value: await consult(teammate, text, call.id) };
    },
  };
}

/** A teammate's steps inside its consultation: plain steps only, numbered on their own. */
class TeammateSteps implements StepList {
  readonly steps: LeafStep[] = [];
  private readonly calls = new Map<string, string>();

  addStep(step: NewStep, callId?: string): void {
    const id = `step-${this.steps.length + 1}`;
    if (callId !== undefined) this.calls.set(callId, id);
    this.steps.push(LeafStepSchema.parse({ ...step, id }));
  }

  finishCall(callId: string, finish: (step: NewStep) => NewStep): boolean {
    const id = this.calls.get(callId);
    const index = this.steps.findIndex((step) => step.id === id);
    const started = this.steps[index];
    if (started === undefined) return false;
    this.calls.delete(callId);
    this.steps[index] = LeafStepSchema.parse({ ...finish(started), id });
    return true;
  }
}

/** How a teammate's run ended, in the words the lead reads. */
function settledAs(session: GraduateSession, trace: Trace): Settled {
  switch (trace.stopReason) {
    case 'refused':
      return { outcome: 'refused', text: `${session.name} refused: ${trace.finalText}` };
    case 'aborted':
      return { outcome: 'stopped', text: stoppedText(session) };
    case 'error':
      return {
        outcome: 'error',
        text: `${session.name} stopped on a problem: ${trace.error ?? 'its model failed.'}`,
      };
    case 'max_steps':
      return {
        outcome: 'out_of_steps',
        text: `${session.name} stopped after ${session.harness.decoding.maxSteps} steps without an answer. ${toolsTried(trace.steps)} Ask it again with more detail.`,
      };
    case 'answer': {
      const { answer } = parseAnswerLine(trace.finalText);
      const changed = (trace.changes ?? []).length > 0;
      if (answer === null && !changed && WRITTEN_CALL.test(trace.finalText)) {
        return {
          outcome: 'no_answer',
          text: `${session.name} wrote a tool call as text instead of running it, so it gave no answer. Ask it again.`,
        };
      }
      const gave = gaveAnswer({ answer, stopReason: 'answer' }, trace.changes, trace.finalText);
      return gave
        ? { outcome: 'answered', text: trace.finalText.trim() }
        : { outcome: 'no_answer', text: `${session.name} finished without an answer.` };
    }
  }
}

function stoppedText(session: GraduateSession): string {
  return `${session.name} was stopped before it answered.`;
}

/** A local runtime's problem, such as a GPU that stayed busy, in its own words; null otherwise. */
function localProblem(error: unknown): string | null {
  const local =
    error instanceof LocalRuntimeError
      ? error
      : error instanceof AdapterError && error.cause instanceof LocalRuntimeError
        ? error.cause
        : null;
  return local === null ? null : `${local.message} ${local.hint}`;
}
