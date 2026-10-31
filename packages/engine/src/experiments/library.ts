import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CodedError } from '@architect/shared';
import type { VaultDeps } from '../loop/deps';
import type { JobLibrary } from '../loop/jobs';
import type { DataPaths } from '../loop/paths';

/** What a field in the library is read from: its stored job and tasks, and its vault. */
export interface LibrarySource {
  jobs: Pick<JobLibrary, 'get' | 'tasks'>;
  paths: Pick<DataPaths, 'jobDir'>;
  vault: Pick<VaultDeps, 'isSealed' | 'stageSealed'>;
}

async function copyIfThere(from: string, to: string): Promise<void> {
  if ((await stat(from).catch(() => null)) === null) return;
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

/**
 * Writes a field in the library as the job folder the comparisons runner reads (decision 074,
 * amended Oct 30): its stored job with the sealed organizations listed again, its tasks (the
 * splits the library keeps, then what the vault sealed), its data, each organization's files,
 * its checker and its starting harness. The same library job gives the same bytes every time,
 * so the runner's pin of the folder holds from one command to the next, and a job changed in
 * the library since is refused as a changed folder would be. `dir` must not exist yet; the
 * caller removes it once the runner has imported it.
 */
export async function stageLibraryJob(
  library: LibrarySource,
  jobId: string,
  dir: string,
): Promise<void> {
  const job = await library.jobs.get(jobId);
  if (!(await library.vault.isSealed(jobId))) {
    throw new CodedError(
      'not_a_job',
      `"${job.name}" has no tasks with a sealed final test yet, so nothing can be compared on it.`,
    );
  }
  await mkdir(dir);
  const from = library.paths.jobDir(jobId);
  const visible = [
    ...(await library.jobs.tasks(jobId, 'calibration')),
    ...(await library.jobs.tasks(jobId, 'train')),
    ...(await library.jobs.tasks(jobId, 'dev')),
  ];
  try {
    await writeFile(
      join(dir, 'tasks.jsonl'),
      visible.map((task) => `${JSON.stringify(task)}\n`).join(''),
    );
    const sealed = await library.vault.stageSealed(jobId, dir);
    const whole =
      sealed.length === 0
        ? job
        : { ...job, organizations: [...(job.organizations ?? []), ...sealed] };
    await writeFile(join(dir, 'job.json'), `${JSON.stringify(whole, null, 2)}\n`);
    await copyIfThere(join(from, 'data'), join(dir, 'data'));
    for (const org of job.organizations ?? []) {
      await copyIfThere(join(from, 'orgs', org.id), join(dir, 'orgs', org.id));
    }
    if (job.checker.kind === 'module') {
      await copyIfThere(join(from, job.checker.path), join(dir, job.checker.path));
    }
    if (job.startingHarness.kind === 'import') {
      await copyIfThere(join(from, job.startingHarness.path), join(dir, job.startingHarness.path));
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
