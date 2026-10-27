export const camelToSnake = (key: string): string =>
  key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export const snakeToCamel = (key: string): string =>
  key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Renames the keys of every object in a value. Only for structures with fixed field names. */
export function mapKeys(value: unknown, rename: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => mapKeys(item, rename));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [rename(key), mapKeys(inner, rename)]),
    );
  }
  return value;
}

/** Sorts the keys of every object in a value, for free-form JSON whose key order carries no meaning. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}
