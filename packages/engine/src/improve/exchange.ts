import type { CorrectionRequest, ReplyStep, WorkspaceMessage } from '@architect/shared';
import type { PayloadPart } from '../mentor/gate';

/** A tool result longer than this is cut, with a note of how much was left out. */
const MAX_RESULT_CHARS = 4_000;
/** Steps shown from one reply; the rest are counted. */
const MAX_STEPS = 60;

/** One workspace exchange: the person's request and the agent's reply to it. */
export interface Exchange {
  request: WorkspaceMessage;
  reply: WorkspaceMessage;
}

/**
 * The reply a person corrects and the message it answered: the user message just before it in
 * the same chat. Only a settled agent reply can be corrected.
 */
export function exchangeIn(messages: readonly WorkspaceMessage[], messageId: string): Exchange {
  const index = messages.findIndex((message) => message.id === messageId);
  const reply = messages[index];
  if (reply === undefined) throw new Error('That reply is not in this chat.');
  if (reply.role !== 'agent') throw new Error('Teach this corrects an agent reply, not a request.');
  if (reply.status === 'streaming') {
    throw new Error('That reply is still being written. Correct it once it has finished.');
  }
  const request = messages
    .slice(0, index)
    .reverse()
    .find((message) => message.role === 'user');
  if (request === undefined) throw new Error('That reply answers no request in this chat.');
  return { request, reply };
}

function clipped(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n[${text.length - MAX_RESULT_CHARS} more characters left out]`;
}

function resultText(step: Extract<ReplyStep, { kind: 'tool' }>): string {
  return step.error === undefined ? clipped(step.result) : `error: ${step.error}`;
}

/** The reply's work, numbered by model turn, the way a trace is shown to the mentor. */
function workText(reply: WorkspaceMessage): string {
  const trace = reply.trace;
  if (trace === undefined) {
    return 'This reply was saved before replies kept their steps, so only its answer is here.';
  }
  if (trace.length === 0) return 'The agent answered without calling a tool.';
  let turn = 0;
  const lines = trace.slice(0, MAX_STEPS).map((step) => {
    switch (step.kind) {
      case 'model': {
        turn += 1;
        const calls = step.calls.map(
          (call) => `\n[turn ${turn}] call ${call.name} ${call.arguments}`,
        );
        return `[turn ${turn}] model: ${step.text.trim() || '(no text)'}${calls.join('')}`;
      }
      case 'tool':
        return `  ${step.name} returned:\n${resultText(step)
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n')}`;
      case 'skill':
        return `  skill ${step.slug} loaded by ${step.via === 'rule' ? 'a retrieval rule' : 'a read'}`;
      case 'refusal':
        return `  refused a ${step.taskType} request: ${step.reason}`;
    }
  });
  const left = trace.length - MAX_STEPS;
  return left > 0 ? `${lines.join('\n')}\n[${left} more steps left out]` : lines.join('\n');
}

/**
 * Everything the mentor reads for one correction, in parts: the person's request, the agent's
 * work step by step with each call's arguments and result, its answer, and what the person
 * wrote. Nothing else from the workspace, the job or its tasks goes with it.
 */
export function exchangeParts(exchange: Exchange, correction: CorrectionRequest): PayloadPart[] {
  const parts: PayloadPart[] = [
    { label: "the person's request", text: `# The person's request\n${exchange.request.text}` },
    { label: "the agent's work", text: `# The agent's work\n${workText(exchange.reply)}` },
    {
      label: "the agent's answer",
      text: `# The agent's answer\n${exchange.reply.text.trim() || '(no text)'}`,
    },
    { label: 'the correction', text: `# What the person says was wrong\n${correction.wrong}` },
  ];
  if (correction.wanted !== undefined) {
    parts.push({ label: 'what they wanted', text: `# What they wanted\n${correction.wanted}` });
  }
  if (correction.evidence !== undefined) {
    parts.push({ label: 'their evidence', text: `# Their evidence\n${correction.evidence}` });
  }
  return parts;
}
