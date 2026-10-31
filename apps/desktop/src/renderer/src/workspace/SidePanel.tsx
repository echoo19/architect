import { useEffect, useRef } from 'react';
import type { CellValue, RowDiff } from '@architect/shared';
import { IconButton, Reveal, StepTransition } from '@architect/ui';
import { X } from 'lucide-react';
import { PatchLines } from '../components/PatchLines';
import { DataTable, RowDiffTable } from './tables';

/**
 * What the side panel shows: a whole table from a reply or a step, or the full preview of a
 * change: its rows for a table, its lines for any other file.
 */
export type PanelContent =
  | { kind: 'table'; title: string; columns: string[]; rows: CellValue[][] }
  | { kind: 'diff'; file: string; diff: RowDiff }
  | { kind: 'patch'; file: string; patch: string };

export interface SidePanelProps {
  content: PanelContent;
  onClose: () => void;
}

const CHANGE_TITLE: Record<Exclude<PanelContent['kind'], 'table'>, string> = {
  diff: 'Rows to write to',
  patch: 'Lines to write to',
};

/** The aside next to a chat. It takes focus when it opens; Escape closes it. */
export function SidePanel({ content, onClose }: SidePanelProps) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, [content]);

  const label =
    content.kind === 'table' ? content.title : `${CHANGE_TITLE[content.kind]} ${content.file}`;
  return (
    <Reveal className="mb-3 mr-3 flex min-w-0 max-w-[50%] shrink basis-[460px]">
      <aside
        ref={panel}
        tabIndex={-1}
        aria-label={label}
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card surface-card outline-none"
      >
        <div className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line py-1.5 pl-5 pr-2">
          <span className="truncate text-body font-medium">
            {content.kind === 'table' ? (
              content.title
            ) : (
              <>
                {CHANGE_TITLE[content.kind]}{' '}
                <span className="font-mono text-ui">{content.file}</span>
              </>
            )}
          </span>
          <IconButton label="Close preview" onClick={onClose}>
            <X size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </div>
        <StepTransition transitionKey={label} className="min-h-0 flex-1 overflow-auto p-5">
          {content.kind === 'table' && (
            <DataTable label={label} columns={content.columns} rows={content.rows} />
          )}
          {content.kind === 'diff' && <RowDiffTable diff={content.diff} />}
          {content.kind === 'patch' && (
            <PatchLines patch={content.patch} label="Lines this change writes" />
          )}
        </StepTransition>
      </aside>
    </Reveal>
  );
}
