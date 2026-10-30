import { join, relative, sep } from 'node:path';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Ids become folder names, so only plain ones are accepted. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

function safe(id: string): string {
  if (!isSafeId(id)) throw new Error(`"${id}" can't be used as a folder name.`);
  return id;
}

export type VisibleSplit = 'calibration' | 'train' | 'dev';

/** The teacher's study of a field job's organizations, in the job's folder (decision 069). */
export const STUDY_FILE = 'study.json';

/**
 * Where everything lives in the app's data folder (docs/ARCHITECTURE.md). The database stores
 * paths relative to the folder, with forward slashes, so the folder can move.
 */
export class DataPaths {
  constructor(readonly root: string) {}

  get database(): string {
    return join(this.root, 'architect.db');
  }

  get vault(): string {
    return join(this.root, 'vault');
  }

  toStored(absolute: string): string {
    return relative(this.root, absolute).split(sep).join('/');
  }

  fromStored(stored: string): string {
    return join(this.root, ...stored.split('/'));
  }

  jobDir(jobId: string): string {
    return join(this.root, 'jobs', safe(jobId));
  }

  /** Every job's folder is in this one. */
  get jobs(): string {
    return join(this.root, 'jobs');
  }

  jobFile(jobId: string): string {
    return join(this.jobDir(jobId), 'job.json');
  }

  /**
   * Present while a job is being made, from its folder's first file to its place in the library.
   * A folder that has it and no place in the library is what an interrupted job leaves.
   */
  finalizingMark(jobId: string): string {
    return join(this.jobDir(jobId), 'finalizing');
  }

  dataDir(jobId: string): string {
    return join(this.jobDir(jobId), 'data');
  }

  /** What drafting the job left: where its tasks came from, and what drafting cost. */
  draftingFile(jobId: string): string {
    return join(this.jobDir(jobId), 'drafting.json');
  }

  /** What the person confirmed about a job's rules, and over which records (decision 061). */
  confirmationFile(jobId: string): string {
    return join(this.jobDir(jobId), 'confirmation.json');
  }

  /** One organization's files in a field job (docs/FIELD.md, the contract). */
  orgDataDir(jobId: string, orgId: string): string {
    return join(this.jobDir(jobId), 'orgs', safe(orgId), 'data');
  }

  /** The teacher's study of the organizations' material, and whether it is confirmed (069). */
  studyFile(jobId: string): string {
    return join(this.jobDir(jobId), STUDY_FILE);
  }

  tasksFile(jobId: string, split: VisibleSplit): string {
    return join(this.jobDir(jobId), 'tasks', `${split}.jsonl`);
  }

  runDir(jobId: string, runId: string): string {
    return join(this.jobDir(jobId), 'runs', safe(runId));
  }

  /** The job as it was when the run started; the run always uses this copy. */
  runJobFile(jobId: string, runId: string): string {
    return join(this.runDir(jobId, runId), 'job.json');
  }

  harnessDir(jobId: string, runId: string): string {
    return join(this.runDir(jobId, runId), 'harness');
  }

  traceFile(jobId: string, runId: string, attemptId: string): string {
    return join(this.runDir(jobId, runId), 'traces', `${safe(attemptId)}.json`);
  }

  /** What the mentor was sent and what it returned in a round; written only for calls that ran. */
  /** A round's author request and reply; `fix` names the fix of a reply the runner refused. */
  mentorFile(jobId: string, runId: string, round: number, fix = 0): string {
    const name = fix === 0 ? `round-${round}.json` : `round-${round}-fix-${fix}.json`;
    return join(this.runDir(jobId, runId), 'mentor', name);
  }

  lineageFile(jobId: string, runId: string): string {
    return join(this.runDir(jobId, runId), 'lineage.jsonl');
  }

  /**
   * Every event the run sent, one JSON line each in the order sent, with the time it was sent:
   * what a screen saw while the run was live, kept so the run can be shown again later.
   */
  eventsFile(jobId: string, runId: string): string {
    return join(this.runDir(jobId, runId), 'events.jsonl');
  }

  /** An agent's folder: its versions, and the files of a format 1 graduate made before them. */
  graduateDir(graduateId: string): string {
    return join(this.root, 'graduates', safe(graduateId));
  }

  /** One immutable version of an agent: a package folder (decision 038). */
  versionDir(graduateId: string, version: number): string {
    return join(this.graduateDir(graduateId), 'versions', `v${String(version).padStart(4, '0')}`);
  }

  /** The folder a graduate's `data` resource is bound to by default, seeded from its job's data. */
  workspaceDir(graduateId: string): string {
    return join(this.root, 'workspace', safe(graduateId));
  }

  /** The folder a graduate's `output` resource is bound to by default. */
  outputDir(graduateId: string): string {
    return join(this.root, 'outputs', safe(graduateId));
  }

  /**
   * This computer's copy of a ready-made agent's data, the folder its `data/` is chosen from
   * (decision 054). It sits apart from every agent's own folders, so removing an agent keeps it.
   */
  sampleDataDir(name: string): string {
    return join(this.root, 'samples', safe(name), 'data');
  }

  /** Where imports and exports are unpacked and checked before anything else sees them. */
  stagingDir(): string {
    return join(this.root, 'staging');
  }

  /**
   * One host's llama-server folder: its key, process record and logs. Each host that serves
   * adapters (`engine`, `workspace`, `cli`) has its own, so none stops another's server.
   */
  runtimeDir(owner: string): string {
    return join(this.root, 'local-runtime', safe(owner));
  }
}
