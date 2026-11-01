import {
  ASK_TEAMMATE,
  describeCall,
  describeResult,
  describeRowsRead,
  type AgentStep,
  type Harness,
  type StepView,
  type ToolCall,
  type TraceStep,
} from '@architect/shared';

/** A step before the message gives it an id. */
export type NewStep = Omit<AgentStep, 'id'>;
type ToolTrace = Extract<TraceStep, { kind: 'tool' }>;

/** Where a run's steps show: a reply's own, or a teammate's inside its consultation. */
export interface StepList {
  addStep(step: NewStep, callId?: string): void;
  /** Replaces the step of a call that has returned. False when no step shows that call. */
  finishCall(callId: string, finish: (step: NewStep) => NewStep): boolean;
}

/** A team reply's teammates by the name the lead asks for, each with the version that answers. */
export type Teammates = (
  name: string,
) => { graduateId: string; name: string; version: number } | undefined;

const META_CHARS = 60;
const SKILL_FILE = /^\/?skills\/([^/]+)\/SKILL\.md$/;

/**
 * A tool call that has started: the tool, the skill a read of its SKILL.md opens, or, in a team
 * reply, the teammate the lead asks. An ask of no teammate shows as the tool call it is.
 */
export function startedStep(call: ToolCall, harness: Harness, teammates?: Teammates): NewStep {
  const { member } = call.arguments;
  const teammate =
    call.name === ASK_TEAMMATE && typeof member === 'string' ? teammates?.(member) : undefined;
  if (teammate !== undefined) {
    return {
      kind: 'consult',
      name: teammate.name,
      detail: describeCall(call.name, call.arguments),
      status: 'running',
      view: {
        kind: 'consult',
        graduateId: teammate.graduateId,
        version: teammate.version,
        steps: [],
      },
    };
  }
  const skill = skillRead(call, harness);
  if (skill !== undefined) {
    return { kind: 'skill', name: skill, detail: skill, status: 'running' };
  }
  return {
    kind: 'tool',
    name: call.name,
    detail: describeCall(call.name, call.arguments),
    status: 'running',
  };
}

/** The same step once its call has returned, with what it showed when there is more to see. */
export function finishedStep(step: NewStep, result: ToolTrace): NewStep {
  const view = stepView(result);
  let meta: string;
  if (result.error !== undefined) meta = clip(result.error.split('\n')[0] ?? '', META_CHARS);
  else if (view?.kind === 'table') meta = describeRowsRead(view.total, result.result);
  else meta = describeResult(result.name, result.result, result.change);
  return {
    ...step,
    status: result.error === undefined ? 'done' : 'error',
    meta,
    ms: result.latencyMs,
    ...(view === undefined ? {} : { view }),
  };
}

/**
 * Shows one step of a run in `list`: each call as it starts and as it returns, and a skill a
 * retrieval rule loaded. A call that returned without a step of its own gets one then.
 */
export function showStep(
  list: StepList,
  harness: Harness,
  step: TraceStep,
  teammates?: Teammates,
): void {
  switch (step.kind) {
    case 'model':
      for (const call of step.toolCalls) {
        list.addStep(startedStep(call, harness, teammates), call.id);
      }
      return;
    case 'tool': {
      const finish = (started: NewStep) => finishedStep(started, step);
      if (!list.finishCall(step.callId, finish)) {
        const call = { id: step.callId, name: step.name, arguments: step.arguments };
        list.addStep(finish(startedStep(call, harness, teammates)));
      }
      return;
    }
    case 'skill':
      // A skill the model read already shows as the step of its read call.
      if (step.via === 'rule') list.addStep(ruleSkillStep(step.slug));
      return;
    case 'refusal':
      return;
  }
}

/** A skill a retrieval rule loaded for the request before the model ran. */
export function ruleSkillStep(name: string): NewStep {
  return { kind: 'skill', name, detail: name, meta: 'loaded', status: 'done' };
}

/** The rows a table read showed, or the code `run` ran with its output. */
function stepView(result: ToolTrace): StepView | undefined {
  if (result.table && result.error === undefined) return { kind: 'table', ...result.table };
  if (result.name === 'run' && typeof result.arguments.code === 'string') {
    const output =
      result.error ??
      (typeof result.result === 'string' ? result.result : JSON.stringify(result.result));
    return { kind: 'code', code: result.arguments.code, output };
  }
  return undefined;
}

/** The skill a call reads, when it is a read of one of the harness's SKILL.md files. */
function skillRead(call: ToolCall, harness: Harness): string | undefined {
  if (call.name !== 'read' || typeof call.arguments.path !== 'string') return undefined;
  const name = SKILL_FILE.exec(call.arguments.path.trim())?.[1];
  return harness.skills.some((skill) => skill.name === name) ? name : undefined;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
