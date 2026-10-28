import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';

export type Difficulty = 'easy' | 'medium' | 'hard';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
/** Where a shortfall in one difficulty is made up, in order. */
const FALLBACK_ORDER: readonly Difficulty[] = ['medium', 'hard', 'easy'];

/** No answer is right for more than this many tasks of a type (decision 018). */
const MAX_TASKS_PER_ANSWER = 3;

export type Quota = Readonly<Record<Difficulty, number>>;

export interface Candidate<T> {
  value: T;
  /** The rules, and the values written another way, that a careless attempt gets wrong here. */
  traps: string[];
  /** Picks are spread evenly across kinds, so one kind of task can't crowd out the rest. */
  kind: string;
  /** What an attempt has to work out, as text; picks share no answer more than three times. */
  answer: string;
  /** At most one pick from a group: one task per order, return or customer. */
  group: string;
}

/** No traps is easy, one or two is medium, three or more is hard. */
export function difficultyOf(traps: readonly string[]): Difficulty {
  if (traps.length === 0) return 'easy';
  return traps.length <= 2 ? 'medium' : 'hard';
}

/** What has been picked so far: its groups, and how often each answer is right. */
class Picks<T> {
  readonly list: Candidate<T>[] = [];
  private readonly groups = new Set<string>();
  private readonly answers = new Map<string, number>();

  uses(answer: string): number {
    return this.answers.get(answer) ?? 0;
  }

  allows(candidate: Candidate<T>): boolean {
    return !this.groups.has(candidate.group) && this.uses(candidate.answer) < MAX_TASKS_PER_ANSWER;
  }

  take(candidate: Candidate<T>): void {
    this.list.push(candidate);
    this.groups.add(candidate.group);
    this.answers.set(candidate.answer, this.uses(candidate.answer) + 1);
  }
}

/**
 * Picks the quota of each difficulty. First one candidate for each requirement some candidate
 * meets, so rare cases (a return on the last day of its window) are sure to be in; then, within
 * each difficulty, candidates taken round-robin across kinds, each time the one whose answer has
 * been picked least. A difficulty that runs short is made up from the others. No group gives two
 * picks, and no answer is right for more than three of them.
 */
export function pickMix<T>(
  random: Random,
  candidates: readonly Candidate<T>[],
  quota: Quota,
  label: string,
  required: readonly ((candidate: Candidate<T>) => boolean)[] = [],
): Candidate<T>[] {
  const picks = new Picks<T>();
  const left = { ...quota };
  for (const meets of required) {
    const options = candidates.filter((candidate) => meets(candidate) && picks.allows(candidate));
    if (options.length === 0) continue;
    const choice = random.pick(options);
    picks.take(choice);
    const room = [difficultyOf(choice.traps), ...FALLBACK_ORDER].find((d) => left[d] > 0);
    if (room) left[room] -= 1;
  }

  const pools = new Map(
    DIFFICULTIES.map((difficulty) => [
      difficulty,
      random.shuffle(candidates.filter((c) => difficultyOf(c.traps) === difficulty)),
    ]),
  );
  for (const difficulty of DIFFICULTIES) {
    roundRobin(pools.get(difficulty) ?? [], picks.list.length + left[difficulty], picks);
  }
  const needed = quota.easy + quota.medium + quota.hard;
  for (const difficulty of FALLBACK_ORDER) roundRobin(pools.get(difficulty) ?? [], needed, picks);
  if (picks.list.length < needed) {
    const answers = new Set(candidates.map((c) => c.answer)).size;
    const groups = new Set(candidates.map((c) => c.group)).size;
    throw new Error(
      `${label}: ${candidates.length} candidates (${groups} groups, ${answers} answers) gave ${picks.list.length} of ${needed}`,
    );
  }
  return picks.list;
}

/** Takes candidates from `pool`, one kind after another, until `picks` holds `until`. */
function roundRobin<T>(pool: readonly Candidate<T>[], until: number, picks: Picks<T>): void {
  const kinds = [...new Set(pool.map((candidate) => candidate.kind))].sort(compareText);
  let open = kinds;
  while (picks.list.length < until && open.length > 0) {
    open = open.filter((kind) => {
      if (picks.list.length >= until) return true;
      let best: Candidate<T> | null = null;
      for (const candidate of pool) {
        if (candidate.kind !== kind || !picks.allows(candidate)) continue;
        if (best === null || picks.uses(candidate.answer) < picks.uses(best.answer)) {
          best = candidate;
        }
      }
      if (best === null) return false;
      picks.take(best);
      return true;
    });
  }
}

export function taskId(type: string, index: number): string {
  return `${type}-${String(index + 1).padStart(3, '0')}`;
}
