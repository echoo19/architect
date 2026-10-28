import { DEFAULT_SEED, generateJob, jobDir } from '../index';

const { tasks, files } = await generateJob(jobDir, DEFAULT_SEED);

const mix = new Map<string, number>();
for (const task of tasks) {
  const key = `${task.type} ${String(task.meta?.difficulty)}`;
  mix.set(key, (mix.get(key) ?? 0) + 1);
}
const lines = [...mix.entries()].map(([key, count]) => `  ${key}: ${count}`);
process.stdout.write(
  `Wrote ${files.size} files and ${tasks.length} tasks to ${jobDir}\n${lines.join('\n')}\n`,
);
