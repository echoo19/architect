import { useState, type ReactNode } from 'react';
import type { HarnessFile } from '@architect/shared';
import { cn, Segmented, Skeleton } from '@architect/ui';
import { FileText, Folder } from 'lucide-react';
import { useQuery } from '../api/query';
import { ProblemState } from './ProblemState';

type View = 'files' | 'changes';

/*
 * A harness version's files, read-only (decision 084): the tree of its folder, and the file
 * picked from it line by line. Where the version has a change to show, a toggle sets the
 * whole files beside what changed.
 */
export function HarnessFiles({
  queryKey,
  load,
  changes,
  initial = 'files',
}: {
  queryKey: string;
  load: () => Promise<HarnessFile[]>;
  /** What changed, shown under Changes; absent for a version with nothing to compare. */
  changes?: ReactNode;
  initial?: View;
}) {
  const [view, setView] = useState<View>(changes === undefined ? 'files' : initial);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {changes !== undefined && (
        <Segmented<View>
          aria-label="Show"
          value={view}
          onValueChange={setView}
          className="self-start"
          options={[
            { value: 'changes', label: 'Changes' },
            { value: 'files', label: 'Files' },
          ]}
        />
      )}
      {view === 'changes' ? changes : <FileBrowser queryKey={queryKey} load={load} />}
    </div>
  );
}

function FileBrowser({ queryKey, load }: { queryKey: string; load: () => Promise<HarnessFile[]> }) {
  const files = useQuery(queryKey, load);
  const [picked, setPicked] = useState<string | null>(null);
  if (files.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading the files" className="flex flex-col gap-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (files.status === 'error') {
    return (
      <ProblemState
        layout="inline"
        error={files.error}
        title="Couldn't read its files"
        onRetry={files.reload}
      />
    );
  }
  if (files.data.length === 0) return <p className="m-0 text-ui">No files</p>;
  const open = files.data.find((file) => file.path === picked) ?? files.data[0];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FileTree files={files.data} open={open?.path} onPick={setPicked} />
      {open && <FileLines file={open} />}
    </div>
  );
}

interface TreeRow {
  kind: 'folder' | 'file';
  path: string;
  name: string;
  depth: number;
}

/** The folder's rows in order: each folder once, before the files under it. */
function treeRows(files: readonly HarnessFile[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const folders = new Set<string>();
  // The files at the top of the folder first, then each folder's, by path.
  const sorted = [...files].sort((a, b) => {
    const [aTop, bTop] = [!a.path.includes('/'), !b.path.includes('/')];
    if (aTop !== bTop) return aTop ? -1 : 1;
    return a.path < b.path ? -1 : 1;
  });
  for (const file of sorted) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const folder = parts.slice(0, index).join('/');
      if (folders.has(folder)) continue;
      folders.add(folder);
      rows.push({ kind: 'folder', path: folder, name: parts[index - 1] ?? '', depth: index - 1 });
    }
    rows.push({
      kind: 'file',
      path: file.path,
      name: parts.at(-1) ?? file.path,
      depth: parts.length - 1,
    });
  }
  return rows;
}

function FileTree({
  files,
  open,
  onPick,
}: {
  files: readonly HarnessFile[];
  open: string | undefined;
  onPick: (path: string) => void;
}) {
  return (
    <ul aria-label="Files" className="m-0 flex list-none flex-col p-0">
      {treeRows(files).map((row) => (
        <li key={`${row.kind}:${row.path}`}>
          {row.kind === 'folder' ? (
            <span
              className="flex h-8 items-center gap-2 text-ui"
              style={{ paddingLeft: 8 + row.depth * 16 }}
            >
              <Folder size={14} strokeWidth={1.8} aria-hidden />
              {row.name}
            </span>
          ) : (
            <button
              type="button"
              aria-current={row.path === open ? 'true' : undefined}
              onClick={() => onPick(row.path)}
              className={cn(
                'flex h-8 w-full min-w-0 items-center gap-2 rounded-control pr-2 text-left text-ui',
                'transition-colors duration-150 hover:bg-hover',
                row.path === open && 'bg-selected',
              )}
              style={{ paddingLeft: 8 + row.depth * 16 }}
            >
              <FileText size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate font-mono text-small">{row.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One file, line by line with its numbers, as it is written in the version's folder. */
function FileLines({ file }: { file: HarnessFile }) {
  const lines = file.content.replace(/\n$/, '').split('\n');
  return (
    <article aria-label={file.path} className="min-w-0 overflow-hidden rounded-control shadow-edge">
      <header className="flex items-baseline gap-3 border-b border-line bg-field px-3.5 py-2.5">
        <span className="min-w-0 break-all font-mono text-small">{file.path}</span>
        <span className="ml-auto shrink-0 text-small tabular-nums">
          {lines.length} {lines.length === 1 ? 'line' : 'lines'}
        </span>
      </header>
      <div className="max-h-[480px] overflow-auto">
        <table className="w-full border-collapse font-mono text-small leading-5">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="w-10 select-none px-2 text-right align-top tabular-nums">
                  {index + 1}
                </td>
                <td className="whitespace-pre-wrap break-words py-px pr-3 align-top">{line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
