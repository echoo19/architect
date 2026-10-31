import type { ReactNode } from 'react';
import type { Score } from '@architect/shared';
import { cn } from '@architect/ui';
import { formatPercent } from '../lib/format';

/** A calm line in a card that has nothing to list: what is not there, in a few words. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('m-0 px-6 pb-6 pt-1 text-ui', className)}>{children}</p>;
}

/** A score as a table cell: its pass rate, or nothing (read as absent) when it wasn't tested. */
export function scoreCell(score: Score | null): ReactNode {
  return score ? formatPercent(score) : null;
}

/** "4,210": a count as the person reads one. */
export function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** "1 file", "12 files". */
export function plural(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/**
 * A field's organizations in one line, by the Fields table's counts: "3 taught on · 2 never
 * seen, 1 real", "3 taught on · 1 never seen", or "One organization".
 */
export function orgCountText(counts: {
  taughtOn: number;
  sealed: number;
  real: number | null;
}): string {
  const real = counts.real ?? 0;
  const unseen = counts.sealed + real;
  if (counts.taughtOn === 1 && unseen === 0) return 'One organization';
  const taught = `${count(counts.taughtOn)} taught on`;
  if (unseen === 0) return taught;
  return `${taught} · ${count(unseen)} never seen${real > 0 ? `, ${count(real)} real` : ''}`;
}
