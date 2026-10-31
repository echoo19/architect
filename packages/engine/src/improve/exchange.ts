import {
  GuardError,
  type CorrectionRequest,
  type ReplyStep,
  type WorkspaceMessage,
} from '@architect/shared';
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

/** What the mentor reads of one exchange: the request, the work that answered it, the answer. */
export interface ExchangeText {
  request: string;
  /** Absent for a reply from before replies kept their work. */
  work: readonly ReplyStep[] | undefined;
  answer: string;
  /** Who asked, when it was an agent: a team's lead asking a teammate (decision 100). */
  from?: string;
}

/**
 * A reply's exchange: the agent's own work only. In a team reply a consultation is in it as the
 * call the lead made and the answer it got back, never the teammate's work, which only the
 * teammate's job's mentor may read.
 */
export function exchangeText({ request, reply }: Exchange): ExchangeText {
  return { request: request.text, work: reply.trace, answer: reply.text };
}

/** A teammate's answer inside a team reply, as the lead asked for it. */
export function consultationExchange(
  reply: WorkspaceMessage,
  stepId: string,
  lead: string,
): ExchangeText & { graduateId: string; version: number } {
  const consultation = reply.consultations?.find((each) => each.stepId === stepId);
  if (consultation === undefined) throw new Error('That reply asked no teammate at that step.');
  return {
    graduateId: consultation.graduateId,
    version: consultation.version,
    request: consultation.request,
    work: consultation.work,
    answer: consultation.text,
    from: `${lead}, the agent that asked it`,
  };
}

/**
 * Every agent whose words are in a team chat up to and including one reply: the lead, and each
 * teammate any of those replies asked, since a lead can repeat what a teammate said, in a later
 * reply or in what it asks another. A consultation whose teammate isn't recorded leaves that
 * unknown, so nothing from the chat may go to a mentor.
 */
export function teamChatAgents(
  messages: readonly WorkspaceMessage[],
  messageId: string,
  lead: string,
): string[] {
  const end = messages.findIndex((message) => message.id === messageId);
  const agents = new Set([lead]);
  for (const message of messages.slice(0, end + 1)) {
    const consultations = message.consultations ?? [];
    for (const step of message.steps) {
      if (step.kind !== 'consult') continue;
      const consultation = consultations.find((each) => each.stepId === step.id);
      if (consultation === undefined) {
        throw new GuardError(
          'permission',
          "Nothing was sent: this team chat has a teammate's answer without a record of which agent gave it, so whose words are in it can't be told.",
        );
      }
      agents.add(consultation.graduateId);
    }
  }
  return [...agents];
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
function workText(trace: readonly ReplyStep[] | undefined): string {
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
 * Everything the mentor reads for one correction, in parts: the request, from the person or from
 * the team's lead that asked, the agent's work step by step with each call's arguments and
 * result, its answer, and what the person wrote. Nothing else from the workspace, the job or its
 * tasks goes with it.
 */
export function exchangeParts(
  exchange: ExchangeText,
  correction: CorrectionRequest,
): PayloadPart[] {
  const request =
    exchange.from === undefined
      ? { label: "the person's request", text: `# The person's request\n${exchange.request}` }
      : {
          label: "the lead's request",
          text: `# The request, from ${exchange.from}\n${exchange.request}`,
        };
  const parts: PayloadPart[] = [
    request,
    { label: "the agent's work", text: `# The agent's work\n${workText(exchange.work)}` },
    {
      label: "the agent's answer",
      text: `# The agent's answer\n${exchange.answer.trim() || '(no text)'}`,
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
