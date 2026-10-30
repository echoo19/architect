import { randomBytes } from 'node:crypto';
import {
  ChatCompletionSchema,
  type ChatCompletion,
  type ChatCompletionRequest,
  type CliOutcome,
} from '@architect/shared';
import { CliError, type Failure } from '../exit';
import { outcomeOf, runSteps } from '../run/result';
import type { Reply } from '../run/session';

/** The longest request the agent reads, as for `run --input`. */
const MAX_REQUEST_CHARS = 20_000;

/** A served request: the user's last message, after the turns the client says came before. */
export interface Conversation {
  history: { role: 'user' | 'agent'; text: string }[];
  request: string;
}

type RequestMessage = ChatCompletionRequest['messages'][number];

function textOf(message: RequestMessage): string {
  const { content } = message;
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type !== 'text' || part.text === undefined) {
        throw new CliError(
          'invalid_input',
          'unsupported_content',
          `The agent reads text only, not "${part.type}" parts.`,
        );
      }
      return part.text;
    })
    .join('\n');
}

/**
 * What the agent is asked: the last message, which must be the user's, with the user's and the
 * assistant's earlier turns as its history. System and developer messages are left out: the
 * agent's own harness says how it works, and a caller can't change it. Tool messages are left
 * out too: the agent runs its own tools.
 */
export function conversationOf(request: ChatCompletionRequest): Conversation {
  const last = request.messages.at(-1);
  if (last?.role !== 'user') {
    throw new CliError(
      'invalid_input',
      'last_message_not_user',
      'The last message must be the user’s: it is the one the agent answers.',
    );
  }
  const text = textOf(last);
  if (text.trim() === '') {
    throw new CliError('invalid_input', 'empty_message', 'The last message is empty.');
  }
  if (text.length > MAX_REQUEST_CHARS) {
    throw new CliError(
      'invalid_input',
      'message_too_long',
      `The last message is longer than ${MAX_REQUEST_CHARS.toLocaleString('en-US')} characters.`,
    );
  }
  const history = request.messages.slice(0, -1).flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return [];
    const said = textOf(message);
    if (said.trim() === '') return [];
    return [{ role: message.role === 'user' ? ('user' as const) : ('agent' as const), text: said }];
  });
  return { history, request: text };
}

/** The version that answered, as a served reply names it. */
export interface ServedVersion {
  version: number;
  harnessHash: string;
  /** For a certified version: how many attempts must agree before it answers. Null otherwise. */
  required: number | null;
}

/** An HTTP response: its status and its JSON body. */
export interface Response {
  status: number;
  body: unknown;
}

const STATUS: Readonly<Record<Exclude<CliOutcome, 'succeeded'>, number>> = {
  invalid_input: 400,
  not_permitted: 403,
  task_failed: 502,
  runtime_error: 502,
  cancelled: 503,
};

/** A failure as an OpenAI-style error: what happened and what to do, with a stable code. */
export function errorResponse(failure: Failure): Response {
  return {
    status: failure.code === 'internal' ? 500 : STATUS[failure.outcome],
    body: {
      error: {
        message:
          failure.hint === undefined ? failure.message : `${failure.message} ${failure.hint}`,
        type: failure.outcome,
        code: failure.code,
      },
    },
  };
}

/**
 * A settled reply as a chat completion. It is an answer when the agent answered, handed the
 * request to a person, refused it as outside its job, ran out of steps, or wanted a change to a
 * file: that change is never made here, and comes back in `architect.proposedChange` for the
 * person to make in the app. A reply the model or the runtime broke is an error.
 */
export function completionOf(reply: Reply, served: ServedVersion, model: string): Response {
  const { message } = reply;
  const outcome = outcomeOf(reply);
  const approval = message.failure?.kind === 'approval_required' ? message.failure.approval : null;
  const failure = outcome.failure;
  if (failure && approval === null && failure.code !== 'refused' && failure.code !== 'no_answer') {
    return errorResponse(failure);
  }
  const refusal = message.blocks.find((block) => block.kind === 'refusal');
  const note = message.blocks.find((block) => block.kind === 'note');
  const attempts = message.steps.filter((step) => step.kind === 'attempt');
  const agreed = attempts.filter((step) => step.meta === 'agrees').length;
  const agreement =
    served.required !== null && attempts.length > 0
      ? { agreed, attempts: attempts.length, required: served.required }
      : null;
  const said = message.text.trim();
  const content = [
    said === '' && refusal?.kind === 'refusal'
      ? `I can't help with ${refusal.taskType} requests. ${refusal.reason}`
      : said,
    note?.kind === 'note' ? note.text : '',
    approval === null
      ? ''
      : `${approval.summary} needs a person's approval in Architect, so nothing was written.`,
  ]
    .filter((part) => part !== '')
    .join('\n\n');
  const completion: ChatCompletion = {
    id: `chatcmpl-${randomBytes(12).toString('hex')}`,
    object: 'chat.completion',
    created: Math.floor(Date.parse(message.createdAt) / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: note === undefined ? 'stop' : 'length',
      },
    ],
    architect: {
      version: served.version,
      harnessHash: served.harnessHash,
      certified: served.required !== null,
      agreement,
      handedOff: agreement !== null && agreement.agreed < agreement.required,
      steps: runSteps(message.steps),
      proposedChange:
        approval === null
          ? null
          : {
              tool: approval.tool,
              file: approval.file,
              summary: approval.summary,
              ...(approval.diff === undefined ? {} : { diff: approval.diff }),
              ...(approval.patch === undefined ? {} : { patch: approval.patch }),
            },
      refusal:
        refusal?.kind === 'refusal' ? { taskType: refusal.taskType, reason: refusal.reason } : null,
    },
  };
  return { status: 200, body: ChatCompletionSchema.parse(completion) };
}
