import type { AgentBlock, GraduateSummary, RowDiff } from '@architect/shared';
import { createsFile, lineCounts, patchRows } from '../flow/train/diff';
import { diffLines } from './diff';

type ApprovalBlock = Extract<AgentBlock, { kind: 'approval' }>;
type ChangeShape = Pick<ApprovalBlock, 'op' | 'diff' | 'patch'>;

const VERBS: Record<ApprovalBlock['op'], string> = {
  write: 'Write',
  edit: 'Edit',
  append: 'Add to',
  update: 'Update',
};

/** The verb a change leads with: "Create" for a new file, else "Write", "Edit", "Add to" or "Update". */
export function changeVerb(change: ChangeShape): string {
  if (change.op === 'write' && change.patch !== undefined && createsFile(change.patch)) {
    return 'Create';
  }
  return VERBS[change.op];
}

/** An agent as a change names it: enough to say whose files it writes and to answer for them. */
export type Writer = Pick<GraduateSummary, 'id' | 'name'>;

/**
 * Whose files a change writes (decision 100): the teammate the change itself names, as it was
 * when it asked, whoever is in the team now; the agent that answers when it names none.
 */
export function writerOf(change: Pick<ApprovalBlock, 'agent'>, answering: Writer): Writer {
  return change.agent ? { id: change.agent.graduateId, name: change.agent.name } : answering;
}

/** True when a change makes something new: a new file, or rows or lines added at the end. */
export function addsToFile(change: ChangeShape): boolean {
  return change.op === 'append' || changeVerb(change) === 'Create';
}

/** What a change does to a table's rows: "2 new rows", "1 row changed". */
export function rowCounts({ added, changed, removed }: RowDiff): string {
  const rows = (count: number) => (count === 1 ? 'row' : 'rows');
  return [
    added.length > 0 && `${added.length} new ${rows(added.length)}`,
    changed.length > 0 && `${changed.length} ${rows(changed.length)} changed`,
    removed.length > 0 && `${removed.length} ${rows(removed.length)} removed`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** What a change does, counted: its rows for a table, its lines for any other file. */
export function changeCounts(change: ChangeShape): string {
  if (change.diff) return rowCounts(change.diff);
  if (change.patch !== undefined) return lineCounts(change.patch);
  return '';
}

/** How much a change's preview holds in all: rows for a table, lines for any other file. */
export function previewSize(change: ChangeShape): { count: number; unit: 'rows' | 'lines' } {
  if (change.diff) return { count: diffLines(change.diff).length, unit: 'rows' };
  if (change.patch !== undefined) return { count: patchRows(change.patch).length, unit: 'lines' };
  return { count: 0, unit: 'lines' };
}
