import type { ReactNode } from 'react';
import type { Score } from '@architect/shared';
import { CardRow } from '@architect/ui';
import { formatPercent } from '../lib/format';

/** What a card that has nothing to list lacks, in a few words, as the card's one row. */
export function EmptyRow({ title, className }: { title: string; className?: string }) {
  return <CardRow title={<span className="font-normal">{title}</span>} className={className} />;
}

/** A score as a table cell: its pass rate, or nothing (read as absent) when it wasn't tested. */
export function scoreCell(score: Score | null): ReactNode {
  return score ? formatPercent(score) : null;
}

/** What a column of sealed final test scores means, by the kind of organization it scores. */
export const SCORE_HINTS = {
  seen: 'Pass rate on the sealed final test at organizations it was taught on',
  unseen: 'Pass rate on the sealed final test at generated organizations it never saw',
  real: 'Pass rate on the sealed final test at real organizations it never saw',
} as const;

/** "4,210": a count as the person reads one. */
export function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** "1 file", "12 files". */
export function plural(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/**
 * A field's organizations in one line, by the Fields table's columns: "3 taught on · 1 never
 * seen, 1 real", "3 taught on · 1 never seen", or "One organization". A real organization is
 * counted as real and not as never seen, as the table counts it.
 */
export function orgCountText(counts: {
  taughtOn: number;
  sealed: number;
  real: number | null;
}): string {
  const real = counts.real ?? 0;
  if (counts.taughtOn === 1 && counts.sealed + real === 0) return 'One organization';
  const taught = `${count(counts.taughtOn)} taught on`;
  const unseen = [
    ...(counts.sealed > 0 ? [`${count(counts.sealed)} never seen`] : []),
    ...(real > 0 ? [`${count(real)} real`] : []),
  ];
  return unseen.length === 0 ? taught : `${taught} · ${unseen.join(', ')}`;
}
