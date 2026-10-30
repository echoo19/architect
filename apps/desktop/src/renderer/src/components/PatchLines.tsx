import { cn } from '@architect/ui';
import { patchRows, type DiffLine } from '../flow/train/diff';

const LINE_TONE: Record<DiffLine['kind'], string> = {
  added: 'bg-student-soft',
  removed: 'bg-danger-soft',
  context: '',
  hunk: '',
  note: 'text-fg italic',
};

const MARK: Record<DiffLine['kind'], string> = {
  added: '+',
  removed: '−',
  context: '',
  hunk: '',
  note: '',
};

function PatchRow({ line }: { line: DiffLine }) {
  if (line.kind === 'hunk') {
    return (
      <tr>
        <td colSpan={3} className="px-3 py-0.5 text-center text-fg" aria-label="Lines skipped">
          ⋯
        </td>
      </tr>
    );
  }
  const number = line.kind === 'removed' ? line.oldLine : line.newLine;
  return (
    <tr className={LINE_TONE[line.kind]}>
      <td className="w-10 select-none px-2 text-right align-top text-fg">
        {line.kind === 'note' ? '' : (number ?? '')}
      </td>
      <td
        className={cn(
          'w-4 select-none text-center align-top',
          line.kind === 'added' ? 'text-student' : 'text-danger',
        )}
        aria-hidden
      >
        {MARK[line.kind]}
      </td>
      <td className="whitespace-pre-wrap break-words py-px pr-3 align-top">
        {line.kind === 'added' && <span className="sr-only">Added: </span>}
        {line.kind === 'removed' && <span className="sr-only">Removed: </span>}
        {line.text}
      </td>
    </tr>
  );
}

export interface PatchLinesProps {
  patch: string;
  /** Show only the first lines, e.g. in a chat card. */
  limit?: number;
  /** The table's name for screen readers. */
  label?: string;
  className?: string;
}

/** A file's change line by line: added and removed lines marked, with their line numbers. */
export function PatchLines({ patch, limit, label, className }: PatchLinesProps) {
  const rows = patchRows(patch);
  const shown = limit === undefined ? rows : rows.slice(0, limit);
  return (
    <table
      aria-label={label}
      className={cn('w-full border-collapse font-mono text-small leading-5', className)}
    >
      <tbody>
        {shown.map((line, index) => (
          <PatchRow key={index} line={line} />
        ))}
      </tbody>
    </table>
  );
}
