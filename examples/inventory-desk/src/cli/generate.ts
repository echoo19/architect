import { resolve } from 'node:path';
import { generateJob, jobDir } from '../index';

/** `generate [--out DIR]`: writes the committed job folder, or the same folder elsewhere. */
const at = process.argv.indexOf('--out');
const outDir = resolve(at < 0 ? jobDir : (process.argv[at + 1] ?? jobDir));

const { labs, files, tasks } = await generateJob(outDir);
const lines = labs.map(({ organization, tasks: own, desk }) => {
  const role = organization.role === 'transfer' ? ' (transfer)' : '';
  const { list, short } = desk.chain;
  return `  ${organization.id}: ${organization.name}${role}, ${own.length} tasks; ${list.plate} sends ${list.compounds.join(', ')}, ${short} has nothing to draw`;
});
process.stdout.write(
  `Wrote ${files.size} files and ${tasks.length} tasks to ${outDir}\n${lines.join('\n')}\n`,
);
