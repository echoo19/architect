/**
 * A group's CSV files: a header row and LF line ends. A cell that holds a comma is wrapped in
 * double quotes, the way spreadsheet exports do it. Cells never hold quotes or line breaks.
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

/** Rows keyed by column, with empty cells as null and every other cell exactly as written. */
export function parseCsv(text: string): CsvRow[] {
  const [header, ...lines] = text.replace(/\n$/, '').split('\n');
  if (header === undefined) return [];
  const columns = splitLine(header, 1);
  return lines.map((line, index) => {
    const cells = splitLine(line, index + 2);
    if (cells.length !== columns.length) {
      throw new Error(`Line ${index + 2} has ${cells.length} cells, expected ${columns.length}`);
    }
    return Object.fromEntries(columns.map((column, i) => [column, cells[i] || null]));
  });
}

/** The column names of a CSV file. */
export function csvColumns(text: string): string[] {
  return splitLine(text.slice(0, text.indexOf('\n')), 1);
}

function formatCell(cell: CsvCell): string {
  if (cell === null) return '';
  const text = String(cell);
  if (/["\r\n]/.test(text)) throw new Error(`A cell can't hold quotes or line breaks: ${text}`);
  return text.includes(',') ? `"${text}"` : text;
}

/** One line's cells. A quoted cell runs to the next quote, which must end the cell. */
function splitLine(line: string, lineNumber: number): string[] {
  const cells: string[] = [];
  let at = 0;
  for (;;) {
    if (line[at] === '"') {
      const close = line.indexOf('"', at + 1);
      const after = line[close + 1];
      if (close === -1 || (after !== undefined && after !== ',')) {
        throw new Error(`Line ${lineNumber} has a quoted cell that doesn't end cleanly`);
      }
      cells.push(line.slice(at + 1, close));
      if (after === undefined) return cells;
      at = close + 2;
    } else {
      const comma = line.indexOf(',', at);
      if (comma === -1) {
        cells.push(line.slice(at));
        return cells;
      }
      cells.push(line.slice(at, comma));
      at = comma + 1;
    }
  }
}
