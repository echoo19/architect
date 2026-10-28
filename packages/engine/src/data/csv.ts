import Papa from 'papaparse';
import { DataError } from './errors';
import type { Row } from './types';

export interface ParsedCsv {
  columns: string[];
  rows: Row[];
}

const BOM = '﻿';

/** Parses a CSV with a header row. Every cell stays text; an empty cell becomes null. */
export function parseCsv(name: string, content: string): ParsedCsv {
  const result = Papa.parse<string[]>(content.startsWith(BOM) ? content.slice(1) : content, {
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
  return { columns: header, rows };
}
