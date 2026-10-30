import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildRecordTasks, readAcademyFolder } from '../tasks/records';

/**
 * `record-tasks --data DIR --org ID --as-of YYYY-MM-DD [--seed N] [--out FILE]`: tasks for an
 * academy folder in this schema that has records but no question text, errors or hints, such as
 * a real academy's anonymized export. Writes tasks.jsonl lines to FILE, or to stdout.
 */
function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const data = option('--data') ?? fail('--data takes the academy folder.');
const org = option('--org') ?? fail('--org takes the organization id.');
const asOf = option('--as-of') ?? fail('--as-of takes the date the records are current as of.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) fail('--as-of takes a YYYY-MM-DD date.');
const seed = Number(option('--seed') ?? '1');
if (!Number.isSafeInteger(seed) || seed < 0) fail('--seed takes a whole number.');

const tasks = buildRecordTasks(readAcademyFolder(resolve(data)), { org, seed, asOf });
const lines = tasks.map((task) => `${JSON.stringify(task)}\n`).join('');
const out = option('--out');
if (out === undefined) process.stdout.write(lines);
else {
  writeFileSync(resolve(out), lines, 'utf8');
  process.stderr.write(`Wrote ${tasks.length} tasks to ${resolve(out)}\n`);
}
