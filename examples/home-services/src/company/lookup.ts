/** The first item matching `predicate`. Throws when there is none, naming what was missing. */
export function findOne<T>(items: readonly T[], predicate: (item: T) => boolean, what: string): T {
  const item = items.find(predicate);
  if (item === undefined) throw new Error(`Not found: ${what}`);
  return item;
}
