import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { CodedError, type Job } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultJob, defaultTasks } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

beforeEach(async () => {
  world = await createWorld();
  engine = openEngine(world);
});

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

/** A file outside the job folder, such as one a person downloaded. */
async function beside(name: string, content: string): Promise<string> {
  const file = join(dirname(dirname(world.jobFile)), 'elsewhere', name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return file;
}

/** What an import ends in, when it doesn't end well. */
async function refusal(file: string): Promise<unknown> {
  return engine.jobs.importFile(file).then(
    () => null,
    (error: unknown) => error,
  );
}

describe('importing a file that is not a job file', () => {
  it('says it is not a job file when it is not JSON, and imports nothing', async () => {
    const error = await refusal(await beside('notes.json', 'Remember the milk.'));
    expect(error).toBeInstanceOf(CodedError);
    expect(error).toMatchObject({
      code: 'not_a_job',
      message: "notes.json isn't a job file: it isn't valid JSON.",
    });
    expect(engine.store.jobs.list()).toEqual([]);
    expect(existsSync(join(world.dataDir, 'jobs'))).toBe(false);
  });

  it('says it is not a job file when the JSON is something else, naming the first thing wrong', async () => {
    const error = await refusal(
      await beside('package.json', JSON.stringify({ name: 'a-package' })),
    );
    expect(error).toBeInstanceOf(CodedError);
    expect(error).toMatchObject({ code: 'not_a_job' });
    expect((error as Error).message).toMatch(/^package\.json isn't a job file: format: /);
    expect(engine.store.jobs.list()).toEqual([]);
  });

  it('says it is not a job file when a value in it is out of range', async () => {
    const wrong = {
      ...defaultJob(),
      budget: { maxRounds: 0, maxMentorUsd: 5, maxWallMinutes: 60 },
    };
    const error = await refusal(await beside('job.json', JSON.stringify(wrong)));
    expect(error).toMatchObject({ code: 'not_a_job' });
    expect((error as Error).message).toContain('budget.maxRounds');
  });

  it('names the line of tasks.jsonl that is not a task, as a plain failure of its own', async () => {
    const tasks = join(dirname(world.jobFile), 'tasks.jsonl');
    const [first, second] = defaultTasks().map((task) => JSON.stringify(task));
    await writeFile(tasks, `${first}\n{"id": "x"}\n`);
    const notATask = await refusal(world.jobFile);
    expect(notATask).not.toBeInstanceOf(CodedError);
    expect((notATask as Error).message).toMatch(/^Line 2 of tasks\.jsonl isn't a task: /);

    await writeFile(tasks, `${first}\n${second}\nnot json\n`);
    expect(await refusal(world.jobFile)).toMatchObject({
      message: "Line 3 of tasks.jsonl isn't a task: it isn't valid JSON.",
    });
    expect(engine.store.jobs.list()).toEqual([]);
  });

  it('still imports a job folder whose tasks file was written on Windows', async () => {
    const tasks = defaultTasks();
    await writeFile(
      join(dirname(world.jobFile), 'tasks.jsonl'),
      tasks.map((task) => JSON.stringify(task)).join('\r\n'),
    );
    const job = await engine.jobs.importFile(world.jobFile);
    expect(engine.store.jobs.get(job.id)?.taskCount).toBe(tasks.length);
  });

  it('still imports a job with no tasks, and says a data file is missing from beside the job file', async () => {
    await writeFile(join(dirname(world.jobFile), 'tasks.jsonl'), '');
    const job = await engine.jobs.importFile(world.jobFile);
    expect(engine.store.jobs.get(job.id)?.taskCount).toBe(0);

    const lonely = await beside('job.json', JSON.stringify(defaultJob({ id: 'lonely' })));
    expect(await refusal(lonely)).toMatchObject({
      message:
        'The data file "jobs.csv" is missing; it belongs in a data folder next to the job file.',
    });
  });
});

describe('saving a job with a checker file chosen from elsewhere', () => {
  const checks = 'exports.checks = { total: () => ({ pass: true, reason: "Total matches." }) };\n';

  async function importedJob(): Promise<Job> {
    return engine.jobs.importFile(world.jobFile);
  }

  function keptPath(job: Job): string {
    if (job.checker.kind !== 'module') throw new Error('The job has no checker file.');
    return job.checker.path;
  }

  it('copies it into the job folder under a name that follows its content', async () => {
    const file = await beside('my-checks.js', checks);
    const job = await importedJob();
    const saved = await engine.jobs.save({ ...job, checker: { kind: 'module', path: file } });

    const kept = keptPath(saved);
    expect(isAbsolute(kept)).toBe(false);
    expect(kept).toMatch(/^my-checks-[0-9a-f]{12}\.js$/);
    expect(await readFile(join(engine.paths.jobDir(job.id), kept), 'utf8')).toBe(checks);
    // What is saved, and what a run reads, points at the copy and never at the original.
    expect((await engine.jobs.get(job.id)).checker).toEqual({ kind: 'module', path: kept });
  });

  it('keeps one copy of a file saved again, and a new one when the file changed', async () => {
    const file = await beside('my-checks.js', checks);
    const job = await importedJob();
    const first = await engine.jobs.save({ ...job, checker: { kind: 'module', path: file } });
    const again = await engine.jobs.save({ ...job, checker: { kind: 'module', path: file } });
    expect(again.checker).toEqual(first.checker);

    await writeFile(file, `${checks}// stricter\n`);
    const changed = await engine.jobs.save({ ...job, checker: { kind: 'module', path: file } });
    expect(keptPath(changed)).not.toBe(keptPath(first));
    // The first stays, so a run graded with it still finds it.
    const copies = (await readdir(engine.paths.jobDir(job.id))).filter((name) =>
      name.startsWith('my-checks-'),
    );
    expect(copies).toEqual(expect.arrayContaining([keptPath(first), keptPath(changed)]));
    expect(copies).toHaveLength(2);
  });

  it('leaves a checker that is already inside the job folder as it is', async () => {
    const job = await importedJob();
    await writeFile(join(engine.paths.jobDir(job.id), 'checker.js'), checks);
    const before = await readdir(engine.paths.jobDir(job.id));
    const saved = await engine.jobs.save({
      ...job,
      checker: { kind: 'module', path: 'checker.js' },
    });
    expect(saved.checker).toEqual({ kind: 'module', path: 'checker.js' });
    expect(await readdir(engine.paths.jobDir(job.id))).toEqual(before);
  });

  it('gives a file with an odd name a safe one', async () => {
    const file = await beside('my checks (v2).mjs', checks);
    const job = await importedJob();
    const saved = await engine.jobs.save({ ...job, checker: { kind: 'module', path: file } });
    expect(keptPath(saved)).toMatch(/^my-checks-v2--[0-9a-f]{12}\.mjs$/);
  });

  it('says a file that is gone is gone, and saves nothing', async () => {
    const job = await importedJob();
    const gone = join(dirname(world.jobFile), 'moved.js');
    await expect(
      engine.jobs.save({ ...job, name: 'Renamed', checker: { kind: 'module', path: gone } }),
    ).rejects.toThrow("The checker file moved.js isn't there any more.");
    expect((await engine.jobs.get(job.id)).name).toBe('Service desk');
  });

  it('leaves the job a built-in checker when that is what is saved', async () => {
    const job = await importedJob();
    const saved = await engine.jobs.save({ ...job, name: 'Renamed' });
    expect(saved.checker).toEqual({ kind: 'builtin' });
  });
});
