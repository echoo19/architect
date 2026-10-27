import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';

export type Difficulty = 'easy' | 'medium' | 'hard';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
/** Where a shortfall in one difficulty is made up, in order. */
const FALLBACK_ORDER: readonly Difficulty[] = ['medium', 'easy', 'hard'];

export type Quota = Readonly<Record<Difficulty, number>>;

export interface Candidate<T> {
  value: T;
  /** The rules a careless attempt gets wrong on this task, e.g. `after_hours`. */
  traps: string[];
  /** Picks are spread evenly across kinds, so one kind of task can't crowd out the rest. */
  kind: string;
  /** The answer that passes the task, for picks that share an AnswerCap. */
  answer?: string;
}

/** No traps is easy, one or two is medium, three or more is hard. */
export function difficultyOf(traps: readonly string[]): Difficulty {
  if (traps.length === 0) return 'easy';
  return traps.length <= 2 ? 'medium' : 'hard';
}

/**
 * Keeps any one answer from being right for more than `max` picked tasks, across every pick that
 * shares the cap, so a harness can't pass many tasks by repeating one memorized answer.
 */
export class AnswerCap {
  private readonly counts = new Map<string, number>();

  constructor(private readonly max: number) {}

  allows(candidate: Candidate<unknown>): boolean {
    return candidate.answer === undefined || (this.counts.get(candidate.answer) ?? 0) < this.max;
  }

  take(candidate: Candidate<unknown>): void {
    if (candidate.answer === undefined) return;
    this.counts.set(candidate.answer, (this.counts.get(candidate.answer) ?? 0) + 1);
  }
}

/**
 * Picks the quota of each difficulty. Within a difficulty, candidates are shuffled and taken
 * round-robin across kinds. If a difficulty runs short (another seed can make a different
 * company, or a cap rules candidates out), the gap is filled from the other difficulties, medium
 * first.
 */
export function pickMix<T>(
  random: Random,
  candidates: readonly Candidate<T>[],
  quota: Quota,
  label: string,
  cap?: AnswerCap,
): Candidate<T>[] {
  const pools = new Map(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      random.shuffle(candidates.filter((c) => difficultyOf(c.traps) === difficulty)),
    ]),
  );
  const poolOf = (difficulty: Difficulty) => pools.get(difficulty) ?? [];
  const picked = DIFFICULTIES.flatMap((difficulty) =>
    roundRobin(poolOf(difficulty), Math.min(quota[difficulty], poolOf(difficulty).length), cap),
  );

  const needed = quota.easy + quota.medium + quota.hard;
  for (const difficulty of FALLBACK_ORDER) {
    const rest = poolOf(difficulty).filter((candidate) => !picked.includes(candidate));
    picked.push(...roundRobin(rest, Math.min(rest.length, needed - picked.length), cap));
  }
  if (picked.length < needed) {
    throw new Error(`${label}: ${candidates.length} candidates, ${needed} needed`);
  }
  return picked;
}

/**
 * Like pickMix, but first takes one candidate for each requirement that some candidate meets, so
 * rare cases (a job logged at exactly 61 minutes) are sure to be among the picks. Each counts
 * against its difficulty's quota, and the rest of the quota is filled as pickMix fills it.
 */
export function pickMixWith<T>(
  random: Random,
  candidates: readonly Candidate<T>[],
  quota: Quota,
  label: string,
  required: readonly ((candidate: Candidate<T>) => boolean)[],
  cap?: AnswerCap,
): Candidate<T>[] {
  const picked: Candidate<T>[] = [];
  const left = { ...quota };
  for (const meets of required) {
    const options = candidates.filter(
      (candidate) =>
        meets(candidate) && !picked.includes(candidate) && (!cap || cap.allows(candidate)),
    );
    if (options.length === 0) continue;
    const choice = random.pick(options);
    picked.push(choice);
    cap?.take(choice);
    const difficulty = difficultyOf(choice.traps);
    const room = [difficulty, ...FALLBACK_ORDER].find((d) => left[d] > 0);
    if (room) left[room] -= 1;
  }
  const rest = candidates.filter((candidate) => !picked.includes(candidate));
  return [...picked, ...pickMix(random, rest, left, label, cap)];
}

function roundRobin<T>(
  pool: readonly Candidate<T>[],
  count: number,
  cap: AnswerCap | undefined,
): Candidate<T>[] {
  const byKind = new Map<string, Candidate<T>[]>();
  for (const candidate of pool) {
    byKind.set(candidate.kind, [...(byKind.get(candidate.kind) ?? []), candidate]);
  }
  const queues = [...byKind.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, queue]) => queue);
  const picked: Candidate<T>[] = [];
  while (picked.length < count && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next === undefined || picked.length >= count) continue;
      if (cap && !cap.allows(next)) continue;
      picked.push(next);
      cap?.take(next);
    }
  }
  return picked;
}

export function taskId(type: string, index: number): string {
  return `${type}-${String(index + 1).padStart(3, '0')}`;
}
