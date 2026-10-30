import type { FileDiff } from '@architect/shared';
import { countChanges, parseUnifiedDiff } from '../flow/train/diff';
import { PatchLines } from './PatchLines';

const FILE_STATUS: Record<FileDiff['status'], string> = {
  added: 'added',
  modified: 'changed',
  deleted: 'removed',
};

function lines(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

/** One file's change: its name and what happened to it, then every line, with + and − marks. */
export function FilePatch({ file }: { file: FileDiff }) {
  const { added, removed } = countChanges(parseUnifiedDiff(file.patch));
  return (
    <article
      aria-label={`${file.path}, ${FILE_STATUS[file.status]}`}
      className="overflow-hidden rounded-control shadow-edge"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line bg-field px-3.5 py-2.5">
        <span className="min-w-0 break-all font-mono text-small">{file.path}</span>
        <span className="text-small text-fg">{FILE_STATUS[file.status]}</span>
        <span className="ml-auto text-small text-fg">
          <span className="text-student">{lines(added)} added</span>,{' '}
          <span className="text-danger">{removed} removed</span>
        </span>
      </header>
      <PatchLines patch={file.patch} />
    </article>
  );
}
