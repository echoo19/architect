import Papa from 'papaparse';
import { DataError } from './errors';
import type { Row } from './types';

/** How a CSV file was written, so saving it keeps its line endings and byte-order mark. */
export interface CsvFormat {
  linebreak: '\n' | '\r\n';
  bom: boolean;
}

export interface ParsedCsv {
  columns: string[];
  rows: Row[];
  format: CsvFormat;
}

const BOM = '﻿';

/** Parses a CSV with a header row. Every cell stays text; an empty cell becomes null. */
export function parseCsv(name: string, content: string): ParsedCsv {
  const bom = content.startsWith(BOM);
  const result = Papa.parse<string[]>(bom ? content.slice(1) : content, {
    header: false,
    delimiter: ',',
    skipEmptyLines: true,
  });
  const problem = result.errors[0];
  if (problem) {
    const where = problem.row === undefined ? '' : ` (row ${problem.row + 1})`;
    throw new DataError(`${name} is not valid CSV${where}: ${problem.message}.`);
  }

  const [header, ...records] = result.data;
  if (!header) throw new DataError(`${name} has no header row.`);
  const unnamed = header.findIndex((column) => column === '');
  if (unnamed !== -1) throw new DataError(`${name}: column ${unnamed + 1} has no name.`);
  const duplicate = header.find((column, index) => header.indexOf(column) !== index);
  if (duplicate !== undefined) throw new DataError(`${name} has two columns named "${duplicate}".`);

  const rows = records.map((record, index) => {
    if (record.length !== header.length) {
      throw new DataError(
        `${name}: data row ${index + 1} has ${record.length} values but the header has ${header.length} columns.`,
      );
    }
    return Object.freeze(
      Object.fromEntries(
        header.map((column, i) => [column, record[i] === '' ? null : (record[i] ?? null)]),
      ),
    );
  });
  const linebreak = result.meta.linebreak === '\r\n' ? '\r\n' : '\n';
  return { columns: header, rows, format: { linebreak, bom } };
}

export function serializeCsv(
  columns: readonly string[],
  rows: readonly Row[],
  format: CsvFormat,
): string {
  const body = Papa.unparse(
    { fields: [...columns], data: rows.map((row) => columns.map((column) => row[column] ?? '')) },
    { newline: format.linebreak },
  );
  return `${format.bom ? BOM : ''}${body}${format.linebreak}`;
}
