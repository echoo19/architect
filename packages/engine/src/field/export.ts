import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CodedError,
  FIELD_EXPORT_FORMAT,
  FieldExportManifestSchema,
  GuardError,
  JobSchema,
  SEALED_EVAL_FORMAT,
  TaskSchema,
  trainOrganizations,
  VerifiedEpisodeSchema,
  type FieldExportManifest,
  type Job,
  type SealedHashes,
  type Task,
} from '@architect/shared';
import { transferDetector } from '../drafting/study';
import { readJsonLines } from '../loop/files';
import { orgDataDir } from '../loop/organizations';
import { DataPaths } from '../loop/paths';
import { openEngineStore, type EngineStore } from '../store/engine-store';
import { buildTrainingDataset, DatasetError } from '../training/dataset';
import type { LeakDetector } from '../vault/fingerprint';
import { Vault } from '../vault/vault';
import { SCORE_CLIENT_PY } from './score-client';

/** What a field export may be used for, as its manifest and every demonstration say. */
export const SFT_USES = ['supervised fine-tuning', 'training off this computer'];
const ENV_USES = ['outcome reward for attempts at these train tasks', 'scoring rollouts'];
const EVAL_USES = ["qualification through Architect's runner, which opens them once"];

/** What the vault tells an export about a job's sealed part: detectors and hashes, never content. */
export interface SealedView {
  leakDetector(jobId: string): LeakDetector;
  transferIdentifiers(jobId: string): { id: string; name: string }[];
  sealedHashes(jobId: string): SealedHashes;
}

export interface FieldSource {
  /** The job as the library keeps it: only the organizations it trains on. */
  job: Job;
  /** The job's folder: its checker and each train organization's files at `orgs/<id>/data/`. */
  jobDir: string;
  /** The job's train split. */
  trainTasks: readonly Task[];
  /** Verified episodes of the job's lessons; only those from train tasks are used. */
  episodes: readonly unknown[];
  vault: SealedView;
  now?: () => Date;
}

const sha256 = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');

/**
 * Both of the job's guards as one: locked-test content, and a sealed organization's id or name.
 * The train organizations' own files are held to the second alone: every attempt reads them, so
 * a test prompt may quote them (a question from the bank) without that being a leak.
 */
function sealedDetectors(job: Job, vault: SealedView): { all: LeakDetector; orgs: LeakDetector } {
  const tests = vault.leakDetector(job.id);
  const orgs = transferDetector(job, vault.transferIdentifiers(job.id));
  const all: LeakDetector = {
    scan(text) {
      const found = [tests.scan(text), orgs.scan(text)].filter((scan) => scan.leaked);
      return { leaked: found.length > 0, matchedIds: found.flatMap((scan) => scan.matchedIds) };
    },
  };
  return { all, orgs };
}

/**
 * Writes a field's three assets into `outDir` (docs/SCALE.md, the contract): `sft/` with the
 * checker-verified demonstrations from train tasks, `env/` with the train tasks, the train
 * organizations' files, the checker and the scorer's Python client, `eval/manifest.json` naming
 * the sealed organizations and the locked test by hash only, and `MANIFEST.json`. Everything is
 * built and checked in memory first: a demonstration from another split, or any file that holds
 * locked-test content or names a sealed organization, stops the export with nothing written.
 */
export function exportField(source: FieldSource, outDir: string): FieldExportManifest {
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    throw new Error(`${outDir} already has files in it.`);
  }
  const { files, manifest } = buildFieldExport(source);
  for (const [path, content] of [
    ...files,
    ['MANIFEST.json', `${JSON.stringify(manifest, null, 2)}\n`],
  ]) {
    const target = join(outDir, ...(path as string).split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content as string);
  }
  return manifest;
}

/**
 * A field export built and checked in memory, with nothing written: each file's text by its
 * path, and the manifest. The same guards as writing it, so what it counts is what an export
 * would hold.
 */
export function buildFieldExport(source: FieldSource): {
  files: Map<string, string>;
  manifest: FieldExportManifest;
} {
  const { job, jobDir, vault } = source;
  const orgs = trainOrganizations(job);
  const trainIds = new Set(source.trainTasks.map((task) => task.id));
  const orgIds = new Set(orgs.map((org) => org.id));
  for (const task of source.trainTasks) {
    if (task.org === undefined ? orgs.length > 0 : !orgIds.has(task.org)) {
      throw new GuardError(
        'split',
        `Train task ${task.id} isn't of an organization the job trains on.`,
      );
    }
  }
  const detectors = sealedDetectors(job, vault);
  const files = new Map<string, string>();
  const dataFiles = new Set<string>();

  // sft/: the dataset builder keeps its own guards (train split only, the leak detector).
  const leftOut: { what: string; why: string }[] = [];
  const episodes = source.episodes.filter((raw) => {
    const parsed = VerifiedEpisodeSchema.safeParse(raw);
    if (!parsed.success) return true;
    const { origin, id } = parsed.data;
    if (origin.kind !== 'task') {
      leftOut.push({
        what: `demonstration ${id}`,
        why: 'it comes from a workspace chat, not a train task',
      });
      return false;
    }
    if (origin.split === 'train' && !trainIds.has(origin.taskId)) {
      throw new GuardError(
        'split',
        `Episode ${id} is of task ${origin.taskId}, which isn't a train task of the job.`,
      );
    }
    return true;
  });
  let examples: ReturnType<typeof buildTrainingDataset>['examples'] = [];
  let trainedTurns = 0;
  try {
    const dataset = buildTrainingDataset(episodes, {
      destination: 'remote',
      leakDetector: detectors.all,
      ...(source.now === undefined ? {} : { now: source.now }),
    });
    examples = dataset.examples;
    trainedTurns = dataset.manifest.trained_turns;
    leftOut.push(...dataset.manifest.excluded.map(demonstrationLeftOut));
  } catch (error) {
    if (!(error instanceof DatasetError)) throw error;
    leftOut.push(...error.excluded.map(demonstrationLeftOut));
  }
  files.set(
    'sft/demonstrations.jsonl',
    examples
      .map(
        (example) =>
          `${JSON.stringify({
            ...example,
            verdict: { pass: true, reason: example.provenance.check_reason },
            permitted_uses: SFT_USES,
          })}\n`,
      )
      .join(''),
  );

  // env/: the job as it is checked here, its train tasks and organizations, the checker, the client.
  const envJob: Job = {
    ...job,
    ...(job.organizations === undefined ? {} : { organizations: orgs }),
    ...(job.checker.kind === 'module' ? { checker: { kind: 'module', path: 'checker.js' } } : {}),
  };
  files.set('env/job.json', `${JSON.stringify(envJob, null, 2)}\n`);
  files.set(
    'env/tasks.jsonl',
    source.trainTasks.map((task) => `${JSON.stringify(task)}\n`).join(''),
  );
  if (job.checker.kind === 'module') {
    files.set('env/checker.js', readFileSync(join(jobDir, job.checker.path), 'utf8'));
  }
  const folders =
    orgs.length === 0
      ? [{ from: join(jobDir, 'data'), to: 'env/data' }]
      : orgs.map((org) => ({ from: orgDataDir(jobDir, org.id), to: `env/orgs/${org.id}/data` }));
  for (const { from, to } of folders) {
    for (const file of job.data.files) {
      const path = join(from, file.name);
      if (!existsSync(path) && file.optional === true) continue;
      files.set(`${to}/${file.name}`, readFileSync(path, 'utf8'));
      dataFiles.add(`${to}/${file.name}`);
    }
  }
  files.set('env/score_client.py', SCORE_CLIENT_PY);

  // eval/: the sealed part by hash only.
  const sealed = vault.sealedHashes(job.id);
  files.set(
    'eval/manifest.json',
    `${JSON.stringify(
      {
        format: SEALED_EVAL_FORMAT,
        locked_test: sealed.lockedTest,
        organizations: sealed.organizations,
        permitted_uses: EVAL_USES,
      },
      null,
      2,
    )}\n`,
  );

  for (const [path, content] of files) {
    if ((dataFiles.has(path) ? detectors.orgs : detectors.all).scan(content).leaked) {
      throw new GuardError(
        'split',
        `${path} holds locked-test content or names an organization the job never trains on, so nothing was exported.`,
      );
    }
  }

  const manifest = FieldExportManifestSchema.parse({
    format: FIELD_EXPORT_FORMAT,
    created_at: (source.now?.() ?? new Date()).toISOString(),
    job: {
      id: job.id,
      name: job.name,
      format: job.format,
      created_at: job.createdAt,
      sha256: sha256(files.get('env/job.json') ?? ''),
    },
    counts: {
      demonstrations: examples.length,
      trained_turns: trainedTurns,
      train_tasks: source.trainTasks.length,
      train_organizations: orgs.length,
      sealed_organizations: sealed.organizations.length,
      locked_test_tasks: sealed.lockedTest.tasks,
    },
    files: Object.fromEntries([...files].map(([path, content]) => [path, sha256(content)])),
    permitted_uses: { sft: SFT_USES, env: ENV_USES, eval: EVAL_USES },
    left_out: [
      {
        what: `the locked test (${sealed.lockedTest.tasks} tasks)`,
        why: 'it stays in the vault; eval/manifest.json gives its hash only',
      },
      ...(sealed.organizations.length === 0
        ? []
        : [
            {
              what: `${sealed.organizations.length} organization${sealed.organizations.length === 1 ? '' : 's'} the job never trains on`,
              why: 'sealed in the vault with their files and tasks; eval/manifest.json gives a hash of each',
            },
          ]),
      {
        what: 'the calibration and dev tasks',
        why: 'they stay for measuring and choosing changes, not for training',
      },
      ...leftOut,
    ],
  });
  return { files, manifest };
}

function demonstrationLeftOut(entry: { episode_id: string; reason: string }) {
  return { what: `demonstration ${entry.episode_id}`, why: entry.reason };
}

export interface ExportFromDataOptions {
  /** The app's data folder. */
  dataDir: string;
  /** The job's id, or its name as the app shows it. */
  job: string;
  outDir: string;
}

/**
 * A field export of a job in the app's data folder: the job and its train split as the library
 * keeps them, the verified episodes of its lessons, and the vault's hashes of its sealed part.
 */
export async function exportFieldFromData(
  options: ExportFromDataOptions,
): Promise<FieldExportManifest> {
  const paths = new DataPaths(options.dataDir);
  if (!existsSync(paths.database)) {
    throw new CodedError('job_not_found', `Architect has no jobs in ${options.dataDir}.`);
  }
  const store = openEngineStore(paths.database);
  try {
    const records = store.jobs.list();
    const record =
      records.find((job) => job.id === options.job) ??
      records.find((job) => job.name.toLowerCase() === options.job.toLowerCase());
    if (record === undefined) {
      throw new CodedError('job_not_found', `There is no job "${options.job}".`);
    }
    return exportField(await fieldSource(store, paths, record.id), options.outDir);
  } finally {
    store.close();
  }
}

/**
 * What a field export of a stored job is made from: the job and its train split as the library
 * keeps them, the verified episodes of its lessons, and the vault's view of its sealed part.
 */
export async function fieldSource(
  store: Pick<EngineStore, 'lessons'>,
  paths: DataPaths,
  jobId: string,
): Promise<FieldSource> {
  const job = JobSchema.parse(JSON.parse(readFileSync(paths.jobFile(jobId), 'utf8')));
  const trainTasks = (await readJsonLines(paths.tasksFile(jobId, 'train'))).map((line) =>
    TaskSchema.parse(line),
  );
  const episodes = store.lessons
    .list({ jobId, status: 'verified' })
    .flatMap((lesson) => (lesson.episode === null ? [] : [lesson.episode]));
  return { job, jobDir: paths.jobDir(jobId), trainTasks, episodes, vault: new Vault(paths.root) };
}
