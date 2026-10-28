import {
  describeCall,
  describeResult,
  describeRowsRead,
  type Trace,
  type TraceStep,
} from '@architect/shared';
import { stepWords } from '../../workspace/labels';

/*
 * An attempt played back step by step. A step is one model turn: what the agent said, and the
 * tool calls it made with what each gave back. Steps count from 1, the way Spark's findings and a
 * lesson's checkpoint name them.
 */

export type ToolTraceStep = Extract<TraceStep, { kind: 'tool' }>;

/** One tool call of a step, and the skill it opened when it read one. */
export interface PlaybackCall {
  step: ToolTraceStep;
  skill?: string;
}

export interface PlaybackStep {
  /** The model turn, counting from 1. */
  number: number;
  /** What the agent wrote with its calls, or its answer. */
  text: string;
  calls: PlaybackCall[];
  /** Skills a retrieval rule loaded before the first turn, shown with it. */
  skills: string[];
  /** A guardrail turned the request down before any turn. */
  refusal: { taskType: string; reason: string } | null;
  /** The turn that ended the attempt with its answer. */
  answer: boolean;
  latencyMs: number;
}

/**
 * A trace's steps. Tool calls belong to the turn that made them; a read of a skill's SKILL.md
 * shows as loading that skill; skills a rule loaded before the first turn show with turn 1.
 * `first` numbers the first turn, for a correction that took over partway through.
 */
export function playbackSteps(trace: Trace, first = 1): PlaybackStep[] {
  const steps: PlaybackStep[] = [];
  const early: string[] = [];
  let refusal: PlaybackStep['refusal'] = null;
  for (const item of trace.steps) {
    const current = steps.at(-1);
    switch (item.kind) {
      case 'model':
        steps.push({
          number: first + steps.length,
          text: item.text,
          calls: [],
          skills: steps.length === 0 ? early.splice(0) : [],
          refusal: null,
          answer: false,
          latencyMs: item.latencyMs,
        });
        break;
      case 'tool':
        current?.calls.push({ step: item });
        break;
      case 'skill': {
        const read = current?.calls.at(-1);
        if (item.via === 'tool' && read && read.step.name === 'read') read.skill = item.slug;
        else if (current) current.skills.push(item.slug);
        else early.push(item.slug);
        break;
      }
      case 'refusal':
        refusal = { taskType: item.taskType, reason: item.reason };
        break;
    }
  }
  if (steps.length === 0 && (refusal !== null || early.length > 0 || trace.finalText !== '')) {
    steps.push({
      number: first,
      text: trace.finalText,
      calls: [],
      skills: early,
      refusal,
      answer: trace.stopReason === 'answer' || refusal !== null,
      latencyMs: trace.latencyMs,
    });
  }
  const last = steps.at(-1);
  if (last && last.calls.length === 0 && trace.stopReason === 'answer') last.answer = true;
  return steps;
}

/** A call's line: "Read data/orders.csv · 12 rows", or "Loaded the skill refunds". */
export interface CallLine {
  action: string;
  target: string;
  meta: string;
  failed: boolean;
}

export function callLine({ step, skill }: PlaybackCall): CallLine {
  const failed = step.error !== undefined;
  const words = stepWords({
    id: step.callId,
    kind: skill === undefined ? 'tool' : 'skill',
    name: skill ?? step.name,
    detail: skill ?? describeCall(step.name, step.arguments),
    status: failed ? 'error' : 'done',
  });
  let meta: string;
  if (failed) meta = (step.error ?? '').split('\n')[0] ?? '';
  else if (step.table) meta = describeRowsRead(step.table.total, step.result);
  else meta = describeResult(step.name, step.result, step.change);
  return { ...words, meta, failed };
}

/** The first line of what a step said, for its line in the list. */
export function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}
