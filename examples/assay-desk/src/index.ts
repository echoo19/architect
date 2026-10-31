import { fileURLToPath } from 'node:url';

export { LAB_SEEDS, buildJobFiles, buildLab, generateJob } from './generate';
export type { GeneratedJob, GeneratedLab } from './generate';

/** The committed job folder: job.json, the checker, the tasks and each lab's files. */
export const jobDir = fileURLToPath(new URL('../job/', import.meta.url));

// The building blocks the Inventory desk (examples/inventory-desk), which serves the same labs,
// makes its own job from: the seeded stream, the CSV files, dates, the JSON layout, the agent's
// built-in tools for reference solutions, and how re-test ids are numbered on.
export { Random } from './lib/random';
export { csvColumns, parseCsv, toCsv } from './lib/csv';
export type { CsvCell, CsvRow } from './lib/csv';
export { addDays, longDate } from './lib/calendar';
export { formatJson } from './lib/json-format';
export { writeDate } from './lab/files';
export type { DateForm } from './lab/style';
export { AgentTools, JobFiles } from './reference/tools';
export type { ToolCall } from './reference/tools';
export { nextIds } from './tasks/build';
