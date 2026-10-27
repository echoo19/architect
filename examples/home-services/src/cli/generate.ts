import { DEFAULT_SEED, JOB_VERSIONS, generateJob, jobDir } from '../index';

for (const version of JOB_VERSIONS) {
  const outDir = jobDir(version);
  const { tasks, files } = await generateJob(outDir, version, DEFAULT_SEED);

  const mix = new Map<string, number>();
  for (const task of tasks) {
    const key = `${task.type} ${String(task.meta?.difficulty)}`;
    mix.set(key, (mix.get(key) ?? 0) + 1);
  }
  const lines = [...mix.entries()].map(([key, count]) => `  ${key}: ${count}`);
  process.stdout.write(
    `Version ${version}: wrote ${files.size} files and ${tasks.length} tasks to ${outDir}\n${lines.join('\n')}\n`,
  );
}
