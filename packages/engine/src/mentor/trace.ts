import type { JsonValue, Trace, TraceStep } from '@architect/shared';

export interface TraceLimits {
  /** Characters kept from each model message. */
  text: number;
  /** Characters kept from each tool call's arguments. */
  args: number;
  /** Characters kept from each tool result or error. */
  result: number;
  /** Characters in the whole rendering; the middle is dropped first. */
  total: number;
}

export const TRACE_LIMITS: TraceLimits = { text: 800, args: 400, result: 500, total: 6_000 };

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [${text.length - max} more chars]`;
}

/** A tool result in a few lines: text as it reads, indented under its call, other values as JSON. */
function describeValue(value: JsonValue | null, max: number): string {
  if (typeof value === 'string') return clip(value, max).split('\n').join('\n    ');
  const count = Array.isArray(value) ? `${value.length} items ` : '';
  return count + clip(JSON.stringify(value), max);
}

/**
 * One step's lines. A model step is one turn, numbered from 1, so a diagnosis can point at the
 * turn that went wrong; its tool results follow it, indented.
 */
function stepLines(
  step: TraceStep,
  turn: number,
  limits: TraceLimits,
  /** The turn from which the model read a note in place of this tool step's result, if it did. */
  clearedFrom: number | undefined,
): string[] {
  switch (step.kind) {
    case 'skill':
      return [
        `skill ${step.slug} ${step.via === 'rule' ? 'loaded by a retrieval rule' : 'read by the student'}`,
      ];
    case 'model': {
      const text = step.text.trim();
      return [
        ...(text ? [`[turn ${turn}] model: ${clip(text, limits.text)}`] : []),
        ...step.toolCalls.map(
          (call) =>
            `[turn ${turn}] call ${call.name} ${clip(JSON.stringify(call.arguments), limits.args)}`,
        ),
        ...(text === '' && step.toolCalls.length === 0 ? [`[turn ${turn}] model: (nothing)`] : []),
      ];
    }
    case 'tool':
      return [
        step.error === undefined
          ? `  ${step.name} → ${describeValue(step.result, limits.result)}`
          : `  ${step.name} failed: ${clip(step.error, limits.result)}`,
        ...(clearedFrom === undefined
          ? []
          : [
              `  (cleared to make room: from turn ${clearedFrom} the model read a note here, not this result)`,
            ]),
      ];
    case 'refusal':
      return [`refused as ${step.taskType}: ${step.reason}`];
  }
}

/** Keeps the start and the end of the body within `max`, and always the closing lines. */
function bound(body: string[], closing: string[], max: number): string {
  const whole = [...body, ...closing].join('\n');
  if (whole.length <= max) return whole;
  const budget = max - closing.join('\n').length - 40;
  const head: string[] = [];
  let used = 0;
  let first = 0;
  while (first < body.length && used + body[first]!.length + 1 <= budget / 2) {
    used += body[first]!.length + 1;
    head.push(body[first]!);
    first += 1;
  }
  const tail: string[] = [];
  let last = body.length - 1;
  while (last >= first && used + body[last]!.length + 1 <= budget) {
    used += body[last]!.length + 1;
    tail.unshift(body[last]!);
    last -= 1;
  }
  const omitted = last - first + 1;
  return [...head, `… ${omitted} lines omitted …`, ...tail, ...closing].join('\n');
}

/**
 * A readable, bounded rendering of one attempt for the mentor: what the model said, each tool
 * call with its arguments, truncated results, the final answer and why it stopped.
 */
export function renderCompactTrace(trace: Trace, limits: TraceLimits = TRACE_LIMITS): string {
  let turn = 0;
  const cleared = new Map((trace.cleared ?? []).map((result) => [result.callId, result.turn]));
  const body = trace.steps.flatMap((step) => {
    if (step.kind === 'model') turn += 1;
    return stepLines(
      step,
      turn,
      limits,
      step.kind === 'tool' ? cleared.get(step.callId) : undefined,
    );
  });
  const modelSteps = trace.steps.filter((step) => step.kind === 'model').length;
  const tokens = `${trace.usage.inputTokens} in / ${trace.usage.outputTokens} out tokens`;
  const seconds = (trace.latencyMs / 1000).toFixed(1);
  const error = trace.error === undefined ? '' : ` (${clip(trace.error, 200)})`;
  const closing = [
    `final answer: ${clip(trace.finalText.trim(), limits.text) || '(none)'}`,
    `stopped: ${trace.stopReason}${error} after ${modelSteps} model steps, ${tokens}, ${seconds} s`,
  ];
  return bound(body, closing, limits.total);
}
