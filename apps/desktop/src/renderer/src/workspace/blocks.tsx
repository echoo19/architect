import { useId, useState, type ReactNode } from 'react';
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
} from '@architect/ui';
import { Ban, Check, ChevronRight, CircleMinus, FileText, X } from 'lucide-react';
import { architect } from '../api/client';
import { attempt } from '../lib/notify';
import { diffLines } from './diff';
import { refreshGraduateSettings } from './graduateSettings';
import {
  cellText,
  inSentence,
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
/** Lines a write preview shows in the chat before "Show all". */
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
            {block.columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((row, r) => (
            <TableRow key={r} className={cn(isTotalRow(row) && TOTAL_ROW)}>
              {block.columns.map((_, column) => (
                <TableCell key={column}>{cellText(row[column] ?? null)}</TableCell>
              ))}
            </TableRow>
          ))}
          {total && (
            <>
              <TableRow>
                <TableCell colSpan={block.columns.length} className="text-sm first:text-fg-muted">
                  {hidden} more {hidden === 1 ? 'row' : 'rows'}, included in the total
                </TableCell>
              </TableRow>
              <TableRow className={TOTAL_ROW}>
                {block.columns.map((_, column) => (
                  <TableCell key={column}>{cellText(total[column] ?? null)}</TableCell>
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
  /** Says what Allow and Always allow mean; one card per reply carries it. */
  explain: boolean;
  onOpenPanel: (content: PanelContent) => void;
}

/**
 * A write the agent wants to make: what it touches, the rows it writes, and Allow or Deny. A
 * pending write shows its rows from the start, so nothing is allowed unseen.
 */
export function ApprovalCard({
  block,
  agent,
  answerable,
  explain,
  onOpenPanel,
}: ApprovalCardProps) {
  const previewId = useId();
  const [expanded, setExpanded] = useState(block.status === 'pending');
  const [sending, setSending] = useState<Decision | null>(null);
  const [answer, setAnswer] = useState<Decision | null>(null);
  const lines = diffLines(block.diff).length;

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
  if (block.status === 'denied' || (block.status === 'pending' && answer === 'deny')) {
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
            <FileText size={17} strokeWidth={1.6} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">{block.op === 'append' ? 'Add to' : 'Update'}</span>
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
            <span className="text-sm text-fg-muted">{block.summary}</span>
          </span>
        </button>
        {outcome ?? (
          <div className="flex gap-1.5">
            {choice('deny', 'Deny')}
            {choice('always', 'Always allow')}
            {choice('approve', 'Allow', true)}
          </div>
        )}
      </div>
      {expanded && (
        <div id={previewId} className="border-t border-line-card">
          <div className="overflow-x-auto px-4 pb-2.5 pt-1">
            <RowDiffTable diff={block.diff} limit={DIFF_PREVIEW_LINES} />
          </div>
          {lines > DIFF_PREVIEW_LINES && (
            <button
              type="button"
              className={footerButton}
              onClick={() => onOpenPanel({ kind: 'diff', file: block.file, diff: block.diff })}
            >
              Show all {lines} rows
            </button>
          )}
        </div>
      )}
      {!outcome && explain && (
        <p className="m-0 border-t border-line-card px-4 py-2.5 text-sm text-fg-muted text-pretty">
          Allow writes these rows once. Always allow lets {agent.name} write without asking from now
          on. You can change that in the menu under the message box.
        </p>
      )}
    </div>
  );
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
        <span className="text-sm text-fg-muted text-pretty">
          You&apos;ll need to handle this one yourself.
          {handled.length > 0 && ` ${agent.name} can help with ${listInSentence(handled)}.`}
        </span>
      </span>
    </div>
  );
}

export function NoteBlock({ text }: { text: string }) {
  return <p className="m-0 animate-rise text-sm text-fg-muted">{text}</p>;
}
