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

/**
 * The lines of a unified diff as a person reads them: file headers left out, the first hunk's
 * header dropped since it only starts the excerpt, and later ones kept as gaps between lines.
 */
export function patchRows(patch: string): DiffLine[] {
  const parsed = parseUnifiedDiff(patch);
  const first = parsed.findIndex((line) => line.kind === 'hunk');
  return parsed.filter((_, index) => index !== first);
}

/** True for a patch that makes a new file from nothing. */
export function createsFile(patch: string): boolean {
  return /^--- \/dev\/null$/m.test(patch);
}

/** What a change does to a file's lines: "4 lines" for a new file, else "2 new lines · 1 line removed". */
export function lineCounts(patch: string): string {
  const { added, removed } = countChanges(parseUnifiedDiff(patch));
  const lines = (count: number) => (count === 1 ? 'line' : 'lines');
  if (createsFile(patch)) return `${added} ${lines(added)}`;
  return [
    added > 0 && `${added} new ${lines(added)}`,
    removed > 0 && `${removed} ${lines(removed)} removed`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The unique names behind a set of paths: `tools/a.json` and `tools/a.js` are one helper. */
function distinct(paths: readonly string[], stem: (path: string) => string): number {
  return new Set(paths.map(stem)).size;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * What a change touched, in plain words, from the paths of its files under the harness's own
 * layout: "its instructions, 1 skill and 2 worked examples". Empty when no file changed.
 */
export function changeSummary(files: readonly { path: string }[]): string {
  const paths = files.map((file) => file.path);
  const under = (folder: string) => paths.filter((path) => path.startsWith(`${folder}/`));
  const skills = distinct(under('skills'), (path) => path.split('/')[1] ?? path);
  const helpers = distinct(under('tools'), (path) => path.replace(/\.[^./]+$/, ''));
  const examples = under('examples').length;
  const settings = paths.filter((path) => /^(retrieval|decoding|guardrails)\.yaml$/.test(path));
  const other = paths.filter(
    (path) =>
      path !== 'AGENTS.md' &&
      path !== 'harness.yaml' &&
      !/^(skills|tools|examples)\//.test(path) &&
      !settings.includes(path),
  );
  const parts = [
    paths.includes('AGENTS.md') && 'its instructions',
    skills > 0 && counted(skills, 'skill'),
    helpers > 0 && counted(helpers, 'helper'),
    examples > 0 && counted(examples, 'worked example'),
    settings.length > 0 && 'its settings',
    other.length > 0 && counted(other.length, 'other file'),
  ].filter((part): part is string => typeof part === 'string');
  if (parts.length === 0) return '';
  return parts.length === 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
