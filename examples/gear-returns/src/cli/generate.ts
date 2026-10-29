import { resolve } from 'node:path';
import { DEFAULT_SEED, generateJob, jobDir } from '../index';

/**
 * `generate [--seed N] [--out DIR]`: the committed job folder by default. Another seed builds
 * another business under the same policy, with its own data, tasks and splits, and needs --out,
 * so the committed folder stays the repository's.
 */
function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

const seedText = option('--seed');
const seed = seedText === undefined ? DEFAULT_SEED : Number(seedText);
if (!Number.isSafeInteger(seed) || seed < 0) {
  process.stderr.write('--seed takes a whole number.\n');
  process.exit(2);
}
const outDir = resolve(option('--out') ?? jobDir);
if (seed !== DEFAULT_SEED && outDir === resolve(jobDir)) {
  process.stderr.write('Another seed needs --out, so the committed job folder stays as it is.\n');
  process.exit(2);
}

const { tasks, files } = await generateJob(outDir, seed);

const mix = new Map<string, number>();
for (const task of tasks) {
  const key = `${task.type} ${String(task.meta?.difficulty)}`;
  mix.set(key, (mix.get(key) ?? 0) + 1);
}
const lines = [...mix.entries()].map(([key, count]) => `  ${key}: ${count}`);
process.stdout.write(
  `Wrote ${files.size} files and ${tasks.length} tasks to ${outDir} from seed ${seed}\n${lines.join('\n')}\n`,
);
