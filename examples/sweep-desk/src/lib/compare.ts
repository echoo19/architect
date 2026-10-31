/** Plain code-unit order, the same on every machine (unlike `localeCompare`). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Items by key, each list in the order the items came. */
export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** The first item matching `predicate`. Throws when there is none, naming what was missing. */
export function findOne<T>(items: readonly T[], predicate: (item: T) => boolean, what: string): T {
  const item = items.find(predicate);
  if (item === undefined) throw new Error(`Not found: ${what}`);
  return item;
}
