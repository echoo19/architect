import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PinnedInputsSchema, type Job, type PinnedInputs } from '@architect/shared';

/*
 * What a comparison measures on: a job's tasks, its data and its checker, pinned by their bytes
 * when the plan is made. Every arm imports its own copy of the job when it starts, so a file that
 * changed between two arms would have them measured on different tasks; the runner refuses a
 * folder whose files no longer match the plan, and checks each arm's copy against it too.
 */

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Every file under `dir`, by its path relative to `root` with forward slashes, in order. A link
 * is refused: what it points to could change between one arm's import and the next unpinned.
 */
function filesUnder(root: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `${relative(root, path).split(sep).join('/')} is a link; a comparison pins only files the job folder holds itself.`,
        );
      }
      if (entry.isDirectory()) return filesUnder(root, path);
      return entry.isFile() ? [relative(root, path).split(sep).join('/')] : [];
    })
    .sort();
}

/** One sha256 over many files: each file's path and the sha256 of its bytes, in path order. */
function digestOf(root: string, paths: readonly string[]): string {
  return sha256(
    paths.map((path) => `${path}\0${sha256(readFileSync(join(root, path)))}\n`).join(''),
  );
}

/** The checker module's path inside the job folder, or null when the job's checker is built in. */
function checkerPath(job: Job): string | null {
  return job.checker.kind === 'module' ? job.checker.path.split(/[\\/]/).join('/') : null;
}

/**
 * The job folder as the comparison will measure on it: the sha256 of `job.json`, of the tasks
 * file, of every file under `data/` and each organization's `orgs/<id>/data/` together, and of
 * the checker module.
 */
export function pinInputs(dir: string, job: Job): PinnedInputs {
  const checker = checkerPath(job);
  const tasks = join(dir, 'tasks.jsonl');
  if (!statSync(tasks, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${dir} has no tasks.jsonl beside its job.json.`);
  }
  return PinnedInputsSchema.parse({
    jobId: job.id,
    name: job.name,
    job: sha256(readFileSync(join(dir, 'job.json'))),
    tasks: sha256(readFileSync(tasks)),
    data: digestOf(dir, [
      ...filesUnder(dir, join(dir, 'data')),
      ...filesUnder(dir, join(dir, 'orgs')),
    ]),
    checker: checker === null ? null : sha256(readFileSync(join(dir, checker))),
  });
}

const PARTS = [
  ['tasks', 'tasks'],
  ['data', 'data files'],
  ['checker', 'checker'],
] as const;

/**
 * What changed between two pins of the same job, in words, or null when nothing did. `whole`
 * compares `job.json` too: an arm's own copy rewrites it, so only the source folder is held to it.
 */
export function inputsChanged(
  pinned: PinnedInputs,
  now: PinnedInputs,
  whole: boolean,
): string | null {
  if (now.jobId !== pinned.jobId) return `it is job ${now.jobId}, not ${pinned.jobId}`;
  const changed: string[] = PARTS.filter(([key]) => now[key] !== pinned[key]).map(
    ([, label]) => label,
  );
  if (whole && now.job !== pinned.job) changed.unshift('job.json');
  return changed.length === 0 ? null : `its ${changed.join(', ')} changed`;
}
