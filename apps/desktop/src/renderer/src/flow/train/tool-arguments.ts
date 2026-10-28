import type { JsonValue } from '@architect/shared';

/** A tool call's arguments as people read them: "file technicians.csv · where license = electrical". */
export function describeArguments(args: Record<string, JsonValue>): string {
  return Object.entries(args)
    .map(([name, value]) => `${name} ${describeValue(value)}`)
    .join(' · ');
}

/** Arguments a trace step shows in full under its line: the code `run` ran, the text a change wrote. */
const SHOWN_APART: Record<string, { always: boolean; names: readonly string[] }> = {
  run: { always: true, names: ['code'] },
  write: { always: false, names: ['content'] },
  edit: { always: false, names: ['old_string', 'new_string'] },
  append: { always: false, names: ['text'] },
};

/**
 * A tool call's arguments for its line in a trace, leaving out what the step shows in full under
 * it: the code `run` ran, and the text a change wrote when the change itself is shown.
 */
export function lineArguments(
  name: string,
  args: Record<string, JsonValue>,
  changeShown: boolean,
): Record<string, JsonValue> {
  const apart = SHOWN_APART[name];
  if (!apart || (!apart.always && !changeShown)) return args;
  return Object.fromEntries(Object.entries(args).filter(([key]) => !apart.names.includes(key)));
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
