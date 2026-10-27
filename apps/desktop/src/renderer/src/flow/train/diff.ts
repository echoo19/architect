export type DiffLineKind = 'added' | 'removed' | 'context' | 'hunk' | 'note';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Line number in the old file, for removed and context lines. */
  oldLine?: number;
  /** Line number in the new file, for added and context lines. */
  newLine?: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const FILE_HEADER = /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode )/;

/** Splits a unified diff into lines a person can read, with line numbers. */
export function parseUnifiedDiff(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const rows = patch.replace(/\r\n/g, '\n').split('\n');
  if (rows.at(-1) === '') rows.pop();
  for (const raw of rows) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (!inHunk) {
      if (raw && !FILE_HEADER.test(raw)) lines.push({ kind: 'note', text: raw });
      continue;
    }
    if (raw.startsWith('+')) {
      lines.push({ kind: 'added', text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith('-')) {
      lines.push({ kind: 'removed', text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith('\\')) {
      lines.push({ kind: 'note', text: raw.slice(1).trim() });
    } else {
      // A context line; some tools drop the leading space on blank ones.
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      lines.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return lines;
}

export function countChanges(lines: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((line) => line.kind === 'added').length,
    removed: lines.filter((line) => line.kind === 'removed').length,
  };
}
