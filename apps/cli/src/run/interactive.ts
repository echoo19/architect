import { createInterface } from 'node:readline';
import type { CliOutcome } from '@architect/shared';
import { flag, type Parsed } from '../args';
import type { CliContext } from '../context';
import { failureOf } from '../exit';
import { line, sayFailure, stepLine } from '../render';
import {
  answerOf,
  APPROVAL_QUESTION,
  describeChange,
  isTerminalStream,
  writableOf,
} from './approvals';
import { outcomeOf } from './result';
import { ask, openSession, type ApprovalAnswer, type ApprovalBlock } from './session';

const END_KEY = process.platform === 'win32' ? 'Ctrl+Z then Enter' : 'Ctrl+D';
/** What the conversation prints, on its own line, when the model's reply is asked for again. */
const ASKED_AGAIN = '(asked again)';

/**
 * `architect run <agent>` with no request file: a conversation, one request per line, in one
 * chat, each answered in turn. The answer streams to stdout and the steps to stderr. On a
 * terminal a write that needs approval is asked about there; without one (or with
 * --non-interactive) it fails that reply. Ctrl+C stops a reply; at the prompt, or without a
 * terminal, it ends the session. The exit code is the last reply's, or 0 when there was none.
 */
export async function runInteractive(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { io } = ctx;
  const save = flag(parsed.values, 'save');
  const canAsk = io.terminal && !flag(parsed.values, 'non-interactive');
  const session = await openSession(ctx, parsed.args[0] ?? '', { save });
  const { agent, version, installation } = session;
  line(
    io.stderr,
    `${agent.name}, version ${version.version}, on ${installation.model.model} (${installation.model.runtime}).`,
  );
  line(
    io.stderr,
    canAsk
      ? `Changes to files are asked about here. Ctrl+C stops a reply; ${END_KEY} ends.`
      : `A change that needs approval fails its reply: nobody can answer here. ${END_KEY} ends.`,
  );
  let atLineStart = true;
  /** The marker for a turn asked again was just written; its new text follows it directly. */
  let afterMarker = false;
  const write = (text: string) => {
    // A new paragraph after a line already ended gets one blank line, not two; after the marker,
    // none.
    const lead = afterMarker ? text.replace(/^\n+/, '') : text;
    if (lead === '') return;
    afterMarker = false;
    const shown = atLineStart ? lead.replace(/^\n{2,}/, '\n') : lead;
    io.stdout.write(shown);
    if (shown !== '') atLineStart = shown.endsWith('\n');
  };
  /** Text already printed can't be taken back, so the conversation says the turn started over. */
  const askedAgain = () => {
    if (!atLineStart) write('\n');
    io.stdout.write(`${ASKED_AGAIN}\n`);
    atLineStart = true;
    afterMarker = true;
  };
  const reader = createInterface({
    input: io.stdin,
    output: writableOf(io.stderr),
    terminal: io.terminal && isTerminalStream(io.stdin),
    prompt: '> ',
  });

  try {
    return await new Promise<CliOutcome>((resolve) => {
      let last: CliOutcome = 'succeeded';
      let replying: AbortController | null = null;
      let answering: ((answer: ApprovalAnswer) => void) | null = null;
      const queue: string[] = [];
      let inputEnded = false;
      let done = false;
      const finish = (outcome: CliOutcome) => {
        if (done) return;
        done = true;
        resolve(outcome);
      };
      const prompt = () => {
        if (io.terminal && !inputEnded && queue.length === 0) reader.prompt();
      };

      const approve = (block: ApprovalBlock): Promise<ApprovalAnswer> =>
        new Promise((resolveAnswer) => {
          // Waiting for the answer starts before the question shows: it may come at once.
          answering = resolveAnswer;
          if (!atLineStart) write('\n');
          for (const text of describeChange(block)) line(io.stderr, text);
          io.stderr.write(APPROVAL_QUESTION);
        });

      /** Answers the next request waiting, or ends the session once input has ended. */
      const next = () => {
        if (done || replying) return;
        if (signal.aborted) {
          finish('cancelled');
          return;
        }
        const request = queue.shift();
        if (request === undefined) {
          if (inputEnded) finish(last);
          else prompt();
          return;
        }
        const stop = new AbortController();
        replying = stop;
        ask(session, request, {
          approvals: canAsk ? 'ask' : 'fail',
          ...(canAsk ? { approve } : {}),
          onStep: (step) => {
            if (!atLineStart) write('\n');
            line(io.stderr, stepLine(step));
          },
          onText: write,
          onRetract: askedAgain,
          signal: AbortSignal.any([stop.signal, signal]),
        })
          .then((reply) => {
            if (!atLineStart) write('\n');
            const { outcome, failure } = outcomeOf(reply);
            if (failure) sayFailure(io.stderr, failure);
            last = outcome;
          })
          .catch((error: unknown) => {
            const failure = failureOf(error);
            sayFailure(io.stderr, failure);
            last = failure.outcome;
          })
          .finally(() => {
            replying = null;
            answering = null;
            next();
          });
      };

      const interrupt = () => {
        if (replying) replying.abort(new Error('Stopped.'));
        else finish('cancelled');
      };
      // On a terminal, readline reads Ctrl+C itself and it stops the reply; otherwise the signal
      // brings it, and it ends the session.
      reader.on('SIGINT', interrupt);
      signal.addEventListener(
        'abort',
        () => {
          queue.length = 0;
          if (replying) replying.abort(new Error('Stopped.'));
          else finish('cancelled');
        },
        { once: true },
      );

      reader.on('line', (text) => {
        if (answering) {
          const answered = answering;
          answering = null;
          answered(answerOf(text));
          return;
        }
        const request = text.trim();
        if (request === '') {
          if (!replying) prompt();
          return;
        }
        queue.push(request);
        next();
      });
      reader.on('close', () => {
        inputEnded = true;
        // Nobody is left to answer a waiting approval: it is a no.
        if (answering) {
          const answered = answering;
          answering = null;
          answered('deny');
        }
        next();
      });
      prompt();
    });
  } finally {
    reader.close();
    await session.close();
  }
}
