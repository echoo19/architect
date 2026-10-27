/**
 * The company's CSV files keep to a plain subset: a header row, LF line ends, and no cell that
 * needs quoting (no commas, quotes or line breaks). Lists inside a cell use `;`.
 */

export type CsvCell = string | number | null;
export type CsvRow = Record<string, string | null>;

export function toCsv(columns: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [columns.map(formatCell).join(',')];
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`A row has ${row.length} cells but the header has ${columns.length}`);
    }
    lines.push(row.map(formatCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Rows keyed by column name, with empty cells as null, the way the runner hands them out. */
export function parseCsv(text: string): CsvRow[] {
  if (/["\r]/.test(text)) throw new Error('These CSV files never contain quotes or CR');
  const [header, ...lines] = text.replace(/\n$/, '').split('\n');
  if (header === undefined) return [];
  const columns = header.split(',');
  return lines.map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== columns.length) {
      throw new Error(`Line ${index + 2} has ${cells.length} cells, expected ${columns.length}`);
    }
    return Object.fromEntries(columns.map((column, i) => [column, cells[i] || null]));
  });
}

function formatCell(cell: CsvCell): string {
  if (cell === null) return '';
  const text = String(cell);
  if (/[",\r\n]/.test(text)) throw new Error(`CSV cell would need quoting: ${text}`);
  return text;
}
