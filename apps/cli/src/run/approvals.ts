import { createInterface } from 'node:readline';
import { Writable, type Readable } from 'node:stream';
import type { CellValue } from '@architect/shared';
import type { CliContext } from '../context';
import type { Output } from '../io';
import { line } from '../render';
import type { ApprovalAnswer, ApprovalBlock } from './session';

/** Lines of a change shown before asking; the rest is counted. */
const SHOWN_LINES = 20;

/** A terminal readline can edit lines on and read Ctrl+C from itself. */
export function isTerminalStream(stream: Readable): boolean {
  return 'setRawMode' in stream && typeof stream.setRawMode === 'function';
}

/** A writable stream over an output, for readline's prompts. */
export function writableOf(out: Output): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      out.write(chunk.toString());
      done();
    },
  });
}

const row = (cells: readonly CellValue[]): string =>
  cells.map((cell) => (cell === null ? '' : String(cell))).join(', ');

/** The change a write wants to make, as the app's approval card shows it, in text. */
export function describeChange(block: ApprovalBlock): string[] {
  const lines = [`${block.summary}:`];
  if (block.diff) {
    const { added, removed, changed } = block.diff;
    lines.push(
      ...added.map((cells) => `  + ${row(cells)}`),
      ...removed.map((cells) => `  - ${row(cells)}`),
      ...changed.flatMap((change) => [`  - ${row(change.before)}`, `  + ${row(change.after)}`]),
    );
  } else if (block.patch) {
    lines.push(
      ...block.patch
        .split('\n')
        .filter((text) => /^[+-]/.test(text) && !/^(\+\+\+|---) /.test(text))
        .map((text) => `  ${text}`),
    );
  }
  if (lines.length > SHOWN_LINES + 1) {
    const hidden = lines.length - 1 - SHOWN_LINES;
    return [
      ...lines.slice(0, SHOWN_LINES + 1),
      `  and ${hidden} more line${hidden === 1 ? '' : 's'}`,
    ];
  }
  return lines;
}

/** What someone typed, as an answer to an approval. Anything but yes or always is a no. */
export function answerOf(text: string): ApprovalAnswer {
  const answer = text.trim().toLowerCase();
  if (answer === 'a' || answer === 'always') return 'always';
  return answer === 'y' || answer === 'yes' ? 'approve' : 'deny';
}

export const APPROVAL_QUESTION = 'Allow this change? [y]es, [n]o, [a]lways for this agent: ';

/**
 * Asks on the terminal about each write that needs approval, one line per answer: yes, no, or
 * always (which allows this agent's writes from now on, in the app as well). It never waits on
 * nobody: the end of input is a no, and so is the run stopping. Ctrl+C at the question is a no
 * that also stops the run, through `interrupt`.
 */
export function approvalPrompter(
  ctx: CliContext,
  stopped: AbortSignal,
  interrupt: () => void,
): (block: ApprovalBlock) => Promise<ApprovalAnswer> {
  const { io } = ctx;
  return (block) =>
    new Promise<ApprovalAnswer>((resolve) => {
      for (const text of describeChange(block)) line(io.stderr, text);
      const reader = createInterface({
        input: io.stdin,
        output: writableOf(io.stderr),
        terminal: io.terminal && isTerminalStream(io.stdin),
      });
      let answered = false;
      const answer = (choice: ApprovalAnswer) => {
        if (answered) return;
        answered = true;
        stopped.removeEventListener('abort', onStop);
        reader.close();
        resolve(choice);
      };
      const onStop = () => answer('deny');
      if (stopped.aborted) {
        answer('deny');
        return;
      }
      stopped.addEventListener('abort', onStop, { once: true });
      reader.on('close', () => answer('deny'));
      reader.on('SIGINT', () => {
        answer('deny');
        interrupt();
      });
      reader.question(APPROVAL_QUESTION, (text) => answer(answerOf(text)));
    });
}
