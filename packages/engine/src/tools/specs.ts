import type { BuiltinToolName, ToolSpec } from '@architect/shared';
import { DEFAULT_READ_LIMIT, MAX_READ_LIMIT } from '../data/table-store';

const file = { type: 'string', description: 'Data file name, e.g. invoices.csv.' };
const cellValue = { type: ['string', 'number', 'boolean', 'null'] };
const where = {
  type: 'array',
  description: 'Conditions that must all hold.',
  items: {
    type: 'object',
    properties: {
      column: { type: 'string' },
      op: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'contains', 'in'] },
      value: {
        type: ['string', 'number', 'boolean', 'null', 'array'],
        items: { type: ['string', 'number'] },
        description: 'One value, or a list for in. Numbers compare as numbers.',
      },
    },
    required: ['column', 'op', 'value'],
    additionalProperties: false,
  },
};

/** The runner's own tools. Their behavior is fixed by the job's data and permissions. */
export const BUILTIN_TOOL_SPECS: Readonly<Record<BuiltinToolName, ToolSpec>> = {
  list_files: {
    name: 'list_files',
    description:
      "List the job's data files with their kind (table or text), access (read or write), description, and each table's columns and row count.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  read_table: {
    name: 'read_table',
    description: `Read rows from a table. Cells are text and empty cells are null. Filter with where, pick columns, and page with limit (default ${DEFAULT_READ_LIMIT}, max ${MAX_READ_LIMIT}) and offset. Returns the columns, rows as arrays in column order, the total number of matching rows, and whether more remain.`,
    parameters: {
      type: 'object',
      properties: {
        file,
        where,
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Columns to return. All columns when left out.',
        },
        limit: { type: 'integer', minimum: 0, maximum: MAX_READ_LIMIT },
        offset: { type: 'integer', minimum: 0 },
      },
      required: ['file'],
      additionalProperties: false,
    },
  },
  read_text: {
    name: 'read_text',
    description:
      'Read a text file, such as a policy document. A long file comes back in parts: pass the returned next_offset to read the rest.',
    parameters: {
      type: 'object',
      properties: { file, offset: { type: 'integer', minimum: 0 } },
      required: ['file'],
      additionalProperties: false,
    },
  },
  calculate: {
    name: 'calculate',
    description:
      'Evaluate arithmetic exactly: numbers, + - * / %, parentheses, round(x, digits) (halves round away from zero), floor, ceil, min, max and abs. Use it for every sum, product and rounding.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'For example round(12345 * 0.0825).' },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  append_rows: {
    name: 'append_rows',
    description:
      'Add rows to a writable table. Each row maps column names to values; columns left out stay empty.',
    parameters: {
      type: 'object',
      properties: {
        file,
        rows: {
          type: 'array',
          minItems: 1,
          items: { type: 'object', additionalProperties: cellValue },
        },
      },
      required: ['file', 'rows'],
      additionalProperties: false,
    },
  },
  update_rows: {
    name: 'update_rows',
    description: 'Change cells in the rows of a writable table that match every where condition.',
    parameters: {
      type: 'object',
      properties: {
        file,
        where,
        set: {
          type: 'object',
          additionalProperties: cellValue,
          description: 'Column names and their new values.',
        },
      },
      required: ['file', 'where', 'set'],
      additionalProperties: false,
    },
  },
  load_skill: {
    name: 'load_skill',
    description: 'Load the full steps of one of your skills, by its slug or name.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
};
