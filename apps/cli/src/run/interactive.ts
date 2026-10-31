import { createInterface } from 'node:readline';
import type { CliOutcome } from '@architect/shared';
import { flag, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { failureOf } from '../exit';
import { line, sayFailure, stepLines } from '../render';
import {
  answerOf,
  approvalQuestion,
  describeChange,
  isTerminalStream,
  writableOf,
} from './approvals';
import { outcomeOf } from './result';
import {
  ask,
  openSession,
  openTeamSession,
  type AgentSession,
  type ApprovalAnswer,
  type ApprovalBlock,
  type SessionAgent,
} from './session';

const END_KEY = process.platform === 'win32' ? 'Ctrl+Z then Enter' : 'Ctrl+D';
/** What the conversation prints, on its own line, when the model's reply is asked for again. */
const ASKED_AGAIN = '(asked again)';

/** Who answers, as the session starts: the agent, or the team with each member. */
function openingLines(session: AgentSession): string[] {
  const about = ({ agent, version, installation }: SessionAgent) =>
    `${agent.name}, version ${version.version}, on ${installation.model.model} (${installation.model.runtime})`;
  if (session.team === undefined) return [`${about(session)}.`];
  const { team, members } = session.team;
  return [
    `${team.name}, led by ${session.agent.name}:`,
    ...members.map((member) => `  ${about(member)}.`),
  ];
}

/**
 * `architect run <agent>` with no request file: a conversation, one request per line, in one
 * chat, each answered in turn. With --team the team's lead answers in a team chat and asks its
 * teammates as it needs them (decision 100); each consultation prints with the teammate's own
 * steps, and each write that needs approval names the agent whose write it is. The answer
 * streams to stdout and the steps to stderr. On a terminal a write that needs approval is asked
 * about there; without one (or with
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
  const team = stringOption(parsed.values, 'team');
  const session =
    team === undefined
      ? await openSession(ctx, parsed.args[0] ?? '', { save })
      : await openTeamSession(ctx, team, { save });
  // In a team, a change the lead wants is named as the lead's, as a teammate's is as its own.
  const lead = session.team === undefined ? undefined : session.agent.name;
  for (const text of openingLines(session)) line(io.stderr, text);
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
          for (const text of describeChange(block, lead)) line(io.stderr, text);
          io.stderr.write(approvalQuestion(block, lead));
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
            for (const text of stepLines(step)) line(io.stderr, text);
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
