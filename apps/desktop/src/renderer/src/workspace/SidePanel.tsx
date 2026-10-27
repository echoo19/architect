import { useEffect, useRef } from 'react';
import type { CellValue, RowDiff } from '@architect/shared';
import { IconButton } from '@architect/ui';
import { X } from 'lucide-react';
import { DataTable, RowDiffTable } from './tables';

/** What the side panel shows: a whole table from a reply, or the full preview of a write. */
export type PanelContent =
  | { kind: 'table'; title: string; columns: string[]; rows: CellValue[][] }
  | { kind: 'diff'; title: string; diff: RowDiff };

export interface SidePanelProps {
  content: PanelContent;
  onClose: () => void;
}

/** The aside next to a chat. It takes focus when it opens; Escape closes it. */
export function SidePanel({ content, onClose }: SidePanelProps) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, [content]);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label={content.title}
      className="mb-3 mr-3 flex min-w-0 max-w-[50%] shrink basis-[460px] animate-fade flex-col overflow-hidden rounded-3xl border border-line bg-aside outline-none"
    >
      <div className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line py-1.5 pl-5 pr-2">
        <span className="truncate font-mono text-sm">{content.title}</span>
        <IconButton label="Close preview" onClick={onClose}>
          <X size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {content.kind === 'table' ? (
          <DataTable label={content.title} columns={content.columns} rows={content.rows} />
        ) : (
          <RowDiffTable diff={content.diff} />
        )}
      </div>
    </aside>
  );
}
