const PRINT_WIDTH = 100;

/**
 * JSON laid out the way Prettier formats a .json file (objects open, arrays of plain values on one
 * line when they fit in 100 columns), so the generated job.json passes the repo's format check.
 * Like `JSON.stringify`, it drops properties whose value is undefined.
 */
export function formatJson(value: unknown): string {
  return `${print(value, 0, 0, 0)}\n`;
}

function print(value: unknown, indent: number, column: number, trailing: number): string {
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
      const oneLine = `[${items.map((item) => print(item, 0, 0, 0)).join(', ')}]`;
      if (column + oneLine.length + trailing <= PRINT_WIDTH) return oneLine;
    }
    const lines = items.map((item, i) => {
      const comma = i < items.length - 1 ? 1 : 0;
      return inner + print(item, indent + 2, indent + 2, comma);
    });
    return `[\n${lines.join(',\n')}\n${close}]`;
  }

  const entries = Object.entries(value).filter(([, child]) => child !== undefined);
  if (entries.length === 0) return '{}';
  const lines = entries.map(([key, child], i) => {
    const prefix = `${JSON.stringify(key)}: `;
    const comma = i < entries.length - 1 ? 1 : 0;
    return inner + prefix + print(child, indent + 2, indent + 2 + prefix.length, comma);
  });
  return `{\n${lines.join(',\n')}\n${close}}`;
}
