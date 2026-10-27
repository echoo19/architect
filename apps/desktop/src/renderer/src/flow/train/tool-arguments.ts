import type { JsonValue } from '@architect/shared';

/** A tool call's arguments as people read them: "file technicians.csv · where license = electrical". */
export function describeArguments(args: Record<string, JsonValue>): string {
  return Object.entries(args)
    .map(([name, value]) => `${name} ${describeValue(value)}`)
    .join(' · ');
}

function describeValue(value: JsonValue): string {
  if (Array.isArray(value)) return value.map(describeValue).join(', ');
  if (value === null) return 'none';
  if (typeof value !== 'object') return String(value);
  // A filter on a table, as the data tools take it.
  const { column, op, value: operand } = value;
  if (typeof column === 'string' && typeof op === 'string' && operand !== undefined) {
    return `${column} ${op} ${describeValue(operand)}`;
  }
  return JSON.stringify(value);
}
