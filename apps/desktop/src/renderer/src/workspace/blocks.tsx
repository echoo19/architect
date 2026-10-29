import { useEffect, useId, useState, type ReactNode } from 'react';
import type { AgentBlock, GraduateSummary } from '@architect/shared';
import {
  Button,
  cn,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@architect/ui';
import {
  Ban,
  Check,
  ChevronRight,
  CircleAlert,
  CircleMinus,
  FilePen,
  FilePlus,
  X,
} from 'lucide-react';
import { architect } from '../api/client';
import { PatchLines } from '../components/PatchLines';
import { attempt } from '../lib/notify';
import { addsToFile, changeCounts, changeVerb, previewSize } from './changes';
import { refreshGraduateSettings } from './graduateSettings';
import {
  cellText,
  inSentence,
  isFigureColumn,
  isTotalRow,
  listInSentence,
  previewRows,
  taskTypeLabel,
} from './labels';
import type { PanelContent } from './SidePanel';
import { RowDiffTable, TOTAL_ROW } from './tables';

type TableBlockData = Extract<AgentBlock, { kind: 'table' }>;
type ApprovalBlockData = Extract<AgentBlock, { kind: 'approval' }>;
type RefusalBlockData = Extract<AgentBlock, { kind: 'refusal' }>;

/** Rows a table shows in the chat before "Show all". */
const TABLE_PREVIEW_ROWS = 4;
/** Rows or lines a change's preview shows in the chat before "Show all". */
const DIFF_PREVIEW_LINES = 6;

const footerButton =
  'h-10 w-full border-t border-line-card text-base text-fg-secondary transition-colors duration-150 hover:bg-row-hover hover:text-fg';

export function TableBlock({
  block,
  onOpenPanel,
}: {
  block: TableBlockData;
  onOpenPanel: (content: PanelContent) => void;
}) {
  const title = block.title ?? 'Table';
  const more = block.rows.length > TABLE_PREVIEW_ROWS;
  const shown = previewRows(block.rows, TABLE_PREVIEW_ROWS);
  const hidden = block.rows.length - shown.length;
  // When the total stays in view, say how many rows sit above it, so the sum still adds up.
  const total = hidden > 0 && isTotalRow(shown.at(-1) ?? []) ? shown.at(-1) : undefined;
  const items = total ? shown.slice(0, -1) : shown;
  const hiddenNames = block.rows
    .slice(items.length, block.rows.length - 1)
    .map((row) => cellText(row[0] ?? null))
    .join(', ');
  const align = (column: number) => isFigureColumn(block.rows, column) && 'text-right';
  return (
    <div className="animate-rise">
      <TableCard
        aria-label={title}
        footer={
          more && (
            <button
              type="button"
              className={footerButton}
              onClick={() =>
                onOpenPanel({ kind: 'table', title, columns: block.columns, rows: block.rows })
              }
            >
              Show all {block.rows.length} rows
            </button>
          )
        }
      >
        <TableHeader>
          <TableRow>
            {block.columns.map((column, index) => (
              <TableHead key={column} className={cn(align(index))}>
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row, r) => (
            <TableRow key={r} className={cn(isTotalRow(row) && TOTAL_ROW)}>
              {block.columns.map((_, column) => (
                <TableCell key={column} className={cn(align(column))}>
                  {cellText(row[column] ?? null)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {total && (
            <>
              <TableRow>
                <TableCell colSpan={block.columns.length} className="text-sm first:text-fg-muted">
                  {hidden} more {hidden === 1 ? 'row' : 'rows'}: {hiddenNames}
                </TableCell>
              </TableRow>
              <TableRow className={TOTAL_ROW}>
                {block.columns.map((_, column) => (
                  <TableCell key={column} className={cn(align(column))}>
                    {cellText(total[column] ?? null)}
                  </TableCell>
                ))}
              </TableRow>
            </>
          )}
        </TableBody>
      </TableCard>
    </div>
  );
}

type Decision = 'approve' | 'deny' | 'always';

function Outcome({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-sm text-fg-secondary [&_svg]:shrink-0">
      {icon}
      {children}
    </span>
  );
}

export interface ApprovalCardProps {
  block: ApprovalBlockData;
  agent: GraduateSummary;
  /** False once the reply ended without an answer, for example because it was stopped. */
  answerable: boolean;
  onOpenPanel: (content: PanelContent) => void;
}

/**
 * A change the agent wants to make: what it touches, the rows or lines it writes, and Allow or
 * Deny. A pending change shows its preview from the start, so nothing is allowed unseen. An
 * allowed change that couldn't be saved says why and offers to try again; it never shows as
 * allowed while nothing was written.
 */
export function ApprovalCard({ block, agent, answerable, onOpenPanel }: ApprovalCardProps) {
  const previewId = useId();
  const [expanded, setExpanded] = useState(block.status === 'pending');
  const [sending, setSending] = useState<Decision | null>(null);
  const [answer, setAnswer] = useState<Decision | null>(null);
  const size = previewSize(block);
  const FileIcon = addsToFile(block) ? FilePlus : FilePen;
  // An answer stands until the host moves the change on: a save that fails after an "allow"
  // brings the choice back.
  useEffect(() => setAnswer(null), [block.status, block.error]);
  const unsaved = block.error !== undefined;
  const retrying = block.status === 'pending' && unsaved && answerable;

  const decide = async (decision: Decision) => {
    setSending(decision);
    const sent = await attempt("Couldn't send your answer", async () => {
      await architect().workspace.decide(block.changeId, decision);
      return true;
    });
    setSending(null);
    if (!sent) return;
    setAnswer(decision);
    if (decision === 'always') void refreshGraduateSettings(agent.id);
  };

  let outcome: ReactNode = null;
  if (block.status === 'failed' || (unsaved && (!answerable || answer === 'deny'))) {
    outcome = (
      <Outcome icon={<CircleAlert size={14} className="text-danger" aria-hidden />}>
        Not saved
      </Outcome>
    );
  } else if (block.status === 'denied' || (block.status === 'pending' && answer === 'deny')) {
    outcome = <Outcome icon={<X size={14} aria-hidden />}>Denied</Outcome>;
  } else if (block.status === 'approved' || (block.status === 'pending' && answer)) {
    outcome = (
      <Outcome icon={<Check size={14} aria-hidden />}>
        {answer === 'always' ? 'Always allowed' : 'Allowed'}
      </Outcome>
    );
  } else if (!answerable) {
    outcome = <Outcome icon={<CircleMinus size={14} aria-hidden />}>Not applied</Outcome>;
  }

  const choice = (decision: Decision, label: string, primary = false) => (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="md"
      className="h-[38px]"
      loading={sending === decision}
      disabled={sending !== null}
      onClick={() => void decide(decision)}
    >
      {label}
    </Button>
  );

  return (
    <div
      role="group"
      aria-label={`Write to ${block.file}`}
      className="flex animate-rise flex-col overflow-hidden rounded-2xl border border-line-control bg-card-raised leading-[1.4]"
    >
      <div className="flex flex-wrap items-center gap-3.5 py-3.5 pl-4 pr-3.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={previewId}
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-[1_1_200px] items-center gap-3.5 rounded-md text-left"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-hover text-fg-secondary">
            <FileIcon size={17} strokeWidth={1.6} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">{changeVerb(block)}</span>
              <span className="truncate font-mono text-base">{block.file}</span>
              <ChevronRight
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className={cn(
                  'shrink-0 text-fg-muted transition-transform duration-200',
                  expanded && 'rotate-90',
                )}
              />
            </span>
            <span className="text-sm text-fg-muted">{changeCounts(block) || block.summary}</span>
          </span>
        </button>
        {outcome ??
          (retrying ? (
            <div className="flex gap-1.5">
              {choice('deny', "Don't save")}
              {choice('approve', 'Try again', true)}
            </div>
          ) : (
            <div className="flex gap-1.5">
              {choice('deny', 'Deny')}
              <Tooltip
                content={`${agent.name} will save changes to any of its files without asking. You can change this next to the message box, under Saving files.`}
                side="top"
              >
                {choice('always', 'Allow saving from now on')}
              </Tooltip>
              {choice('approve', 'Allow once', true)}
            </div>
          ))}
      </div>
      {unsaved && (
        <div
          role="alert"
          className="flex items-start gap-2.5 border-t border-line-card px-4 py-3 text-sm text-fg-secondary"
        >
          <CircleAlert size={14} className="mt-[3px] shrink-0 text-danger" aria-hidden />
          <span className="min-w-0 text-pretty">{block.error}</span>
        </div>
      )}
      {expanded && (
        <div id={previewId} className="border-t border-line-card">
          {block.diff ? (
            <div className="overflow-x-auto px-4 pb-2.5 pt-1">
              <RowDiffTable diff={block.diff} limit={DIFF_PREVIEW_LINES} />
            </div>
          ) : (
            block.patch !== undefined && (
              <div className="overflow-x-auto py-2">
                <PatchLines
                  patch={block.patch}
                  limit={DIFF_PREVIEW_LINES}
                  label="Lines this change writes"
                />
              </div>
            )
          )}
          {size.count > DIFF_PREVIEW_LINES && (
            <button
              type="button"
              className={footerButton}
              onClick={() => onOpenPanel(panelOf(block))}
            >
              Show all {size.count} {size.unit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The whole of a change, for the side panel: its rows for a table, its lines otherwise. */
function panelOf(block: ApprovalBlockData): PanelContent {
  return block.diff
    ? { kind: 'diff', file: block.file, diff: block.diff }
    : { kind: 'patch', file: block.file, patch: block.patch ?? '' };
}

/** A request on the agent's refusal list, with the reason from its report card and a way on. */
export function RefusalCard({ block, agent }: { block: RefusalBlockData; agent: GraduateSummary }) {
  const label = taskTypeLabel(agent.manifest, block.taskType);
  const handled = agent.manifest.test.perType
    .filter((type) => !type.refused)
    .map((type) => type.label);
  return (
    <div
      role="note"
      className="flex animate-rise items-start gap-3.5 rounded-2xl border border-line-control bg-card-raised py-3.5 pl-4 pr-5 leading-[1.4]"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-hover text-fg-secondary">
        <Ban size={17} strokeWidth={1.6} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col gap-1 pt-px">
        <span>
          {agent.name} doesn&apos;t handle {inSentence(label)}
        </span>
        <span className="text-sm text-fg-secondary text-pretty">{block.reason}</span>
        {handled.length > 0 && (
          <span className="text-sm text-fg-muted text-pretty">
            It can help with {listInSentence(handled)}.
          </span>
        )}
      </span>
    </div>
  );
}

export function NoteBlock({ text }: { text: string }) {
  return <p className="m-0 animate-rise text-sm text-fg-muted">{text}</p>;
}
