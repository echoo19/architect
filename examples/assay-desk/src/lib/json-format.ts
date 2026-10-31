const PRINT_WIDTH = 100;

/**
 * JSON laid out the way Prettier formats a .json file: every object open, one key per line, and
 * an array of plain values on one line when it fits in 100 columns. The generated job.json then
 * passes the repo's format check as written. Properties whose value is undefined are dropped.
 */
export function formatJson(value: unknown): string {
  return `${layout(value, 0, 0, 0)}\n`;
}

/** `column` is where the value starts on its line; `trailing` is what follows it (a comma). */
function layout(value: unknown, indent: number, column: number, trailing: number): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error(`Not JSON: ${String(value)}`);
    return text;
  }
  const inner = ' '.repeat(indent + 2);
  const close = ' '.repeat(indent);

  if (Array.isArray(value)) {
    const items: unknown[] = value;
    if (items.length === 0) return '[]';
    if (items.every((item) => item === null || typeof item !== 'object')) {
      const flat = `[${items.map((item) => layout(item, 0, 0, 0)).join(', ')}]`;
      if (column + flat.length + trailing <= PRINT_WIDTH) return flat;
    }
    const lines = items.map(
      (item, i) => inner + layout(item, indent + 2, indent + 2, i < items.length - 1 ? 1 : 0),
    );
    return `[\n${lines.join(',\n')}\n${close}]`;
  }

  const entries = Object.entries(value).filter(([, child]) => child !== undefined);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([key, child], i) => {
    const prefix = `${JSON.stringify(key)}: `;
    const comma = i < entries.length - 1 ? 1 : 0;
    return inner + prefix + layout(child, indent + 2, indent + 2 + prefix.length, comma);
  });
  return `{\n${lines.join(',\n')}\n${close}}`;
}
