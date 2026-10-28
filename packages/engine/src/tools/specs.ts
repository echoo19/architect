import type { BuiltinToolName, ToolSpec } from '@architect/shared';

/**
 * The version of the built-in tools: what they do and the text of their results. Traces record
 * it, so an attempt can be replayed on the tools it ran with. Change it whenever either changes.
 */
export const TOOL_RUNTIME = 'architect-tools/2';

export const DEFAULT_READ_LINES = 200;
export const MAX_READ_LINES = 2000;
export const DEFAULT_GREP_MATCHES = 50;
export const MAX_GREP_MATCHES = 200;

const path = (example: string) => ({ type: 'string', description: `Like ${example}.` });

/** The runner's own tools. What they may reach is fixed by the job's data and permissions. */
export const BUILTIN_TOOL_SPECS: Readonly<Record<BuiltinToolName, ToolSpec>> = {
  read: {
    name: 'read',
    description:
      'Read a file. Returns its lines numbered: the line number, a tab, then the text. A long file comes back in parts, and the last line says how many lines are left and the offset to read on from.',
    parameters: {
      type: 'object',
      properties: {
        path: path('data/orders.csv'),
        offset: { type: 'integer', minimum: 1, description: 'The line to start at. Default 1.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_READ_LINES,
          description: `How many lines to read. Default ${DEFAULT_READ_LINES}.`,
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  ls: {
    name: 'ls',
    description:
      'List a folder: each file with its kind (table or text), its size in lines, and whether you can change it. With no path, lists your folders.',
    parameters: {
      type: 'object',
      properties: { path: path('data') },
      additionalProperties: false,
    },
  },
  glob: {
    name: 'glob',
    description:
      'Find files whose path matches a pattern, like data/*.csv or **/*.md. A pattern without a / matches file names in any folder.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string' } },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  grep: {
    name: 'grep',
    description:
      'Search files for lines that match a regular expression. Returns path:line: text for each matching line.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'A JavaScript regular expression, like ORD-10042 or ^C-11\\d\\d,',
        },
        path: {
          type: 'string',
          description: 'A file or folder to search. Every file when left out.',
        },
        glob: {
          type: 'string',
          description: 'Only search files whose path matches this, like *.csv.',
        },
        ignore_case: { type: 'boolean' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_GREP_MATCHES,
          description: `How many matching lines to show. Default ${DEFAULT_GREP_MATCHES}.`,
        },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  write: {
    name: 'write',
    description:
      'Create a file, or replace a file you can change, with the whole text given. A table must keep its header line.',
    parameters: {
      type: 'object',
      properties: { path: path('output/summary.md'), content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  edit: {
    name: 'edit',
    description:
      'Replace exact text in a file you can change. old_string must match exactly once, spaces and line breaks included; set replace_all to change every match.',
    parameters: {
      type: 'object',
      properties: {
        path: path('data/invoices.csv'),
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  append: {
    name: 'append',
    description:
      'Add text to the end of a file you can change, starting on a new line. For a table, give whole CSV rows with the values in its column order.',
    parameters: {
      type: 'object',
      properties: { path: path('data/returns.csv'), text: { type: 'string' } },
      required: ['path', 'text'],
      additionalProperties: false,
    },
  },
  run: {
    name: 'run',
    description:
      'Run JavaScript and get what it prints and the value of its last line. Read files with files.read(path) and files.list(folder). Turn CSV text into rows with csv.parse(text), objects of strings with "" for an empty cell, and rows back into CSV with csv.stringify(rows). today is the working date. There is no network and no clock, and run cannot change files: use write, edit or append for that.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
      additionalProperties: false,
    },
  },
};
