import { resolve } from 'node:path';
import { generateJob, jobDir } from '../index';

/** `generate [--out DIR]`: writes the committed job folder, or the same folder elsewhere. */
const at = process.argv.indexOf('--out');
const outDir = resolve(at < 0 ? jobDir : (process.argv[at + 1] ?? jobDir));

const { academies, files, tasks } = await generateJob(outDir);
const lines = academies.map(({ organization, tasks: own }) => {
  const role = organization.role === 'transfer' ? ' (transfer)' : '';
  return `  ${organization.id}: ${organization.name}${role}, ${own.length} tasks`;
});
process.stdout.write(
  `Wrote ${files.size} files and ${tasks.length} tasks to ${outDir}\n${lines.join('\n')}\n`,
);
