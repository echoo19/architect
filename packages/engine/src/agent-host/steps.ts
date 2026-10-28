import {
  describeCall,
  describeResult,
  type AgentStep,
  type Harness,
  type StepView,
  type ToolCall,
  type TraceStep,
} from '@architect/shared';

/** A step before the message gives it an id. */
export type NewStep = Omit<AgentStep, 'id'>;
type ToolTrace = Extract<TraceStep, { kind: 'tool' }>;

const META_CHARS = 60;
const SKILL_FILE = /^\/?skills\/([^/]+)\/SKILL\.md$/;

/** A tool call that has started: the tool, or the skill a read of its SKILL.md opens. */
export function startedStep(call: ToolCall, harness: Harness): NewStep {
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
  return {
    ...step,
    status: result.error === undefined ? 'done' : 'error',
    meta:
      result.error === undefined
        ? describeResult(result.name, result.result, result.change)
        : clip(result.error.split('\n')[0] ?? '', META_CHARS),
    ms: result.latencyMs,
    ...(view === undefined ? {} : { view }),
  };
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
