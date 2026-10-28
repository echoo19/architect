import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStudent, isLoopbackUrl } from '@architect/adapters';
import { readGraduate, skillFiles } from '@architect/harness';
import {
  GuardError,
  JobSchema,
  type GraduateManifest,
  type Harness,
  type Job,
  type StudentAdapter,
} from '@architect/shared';
import { openAgentFiles, type AgentFiles } from '../files/agent-files';
import { DataPaths } from '../loop/paths';

/** An open graduate: everything its chats share. */
export interface GraduateSession {
  readonly id: string;
  readonly name: string;
  readonly harness: Harness;
  readonly job: Job;
  readonly student: StudentAdapter;
  /** The agent's folder, live: an approved change goes straight to its file. */
  readonly files: AgentFiles;
  /** The student's context window, which bounds how much of a chat it is shown. */
  readonly contextLength: number;
}

export interface GraduateLocation {
  graduateId: string;
  /** The graduate folder. */
  folder: string;
  /** The folder holding the data files the graduate works on; its output/ folder goes inside it. */
  workspaceDataDir: string;
  /** The app's data folder, where the job the graduate was trained for is kept. */
  appDataDir: string;
  /** The most CPU threads the local model may use; its own default when absent. */
  cpuThreads?: number;
}

/**
 * Loads a graduate and checks that it runs on this machine before anything else happens: a
 * student endpoint that isn't loopback is refused before a single request. The student is
 * built without an API key, since a local runtime needs none.
 */
export async function openGraduateSession(location: GraduateLocation): Promise<GraduateSession> {
  const { harness, manifest } = await readGraduate(location.folder);
  if (manifest.id !== location.graduateId) {
    throw new Error(
      `${location.folder} holds the graduate "${manifest.id}", not "${location.graduateId}".`,
    );
  }
  assertLocalStudent(manifest);
  const job = await readJob(new DataPaths(location.appDataDir), manifest);
  const { runtime, baseUrl, model, contextLength } = manifest.student;
  return {
    id: manifest.id,
    name: manifest.name,
    harness,
    job,
    student: createStudent(
      { runtime, baseUrl, model, contextLength },
      location.cpuThreads === undefined ? {} : { cpuThreads: location.cpuThreads },
    ),
    files: await openAgentFiles({
      dataDir: location.workspaceDataDir,
      files: job.data.files,
      ...(job.data.output === undefined
        ? {}
        : { output: { ...job.data.output, dir: join(location.workspaceDataDir, 'output') } }),
      skills: skillFiles(harness),
      mode: 'live',
    }),
    contextLength,
  };
}

function assertLocalStudent(manifest: GraduateManifest): void {
  const { baseUrl } = manifest.student;
  if (isLoopbackUrl(baseUrl)) return;
  throw new GuardError(
    'network',
    `${manifest.name} is set to run its model at ${new URL(baseUrl).host}, which isn't this computer. Graduates only run on a local model, so it wasn't opened.`,
  );
}

/**
 * The job as the graduate's run saw it: its data files and permissions. A graduate imported
 * from elsewhere falls back to the job's current file.
 */
async function readJob(paths: DataPaths, manifest: GraduateManifest): Promise<Job> {
  for (const file of [
    paths.runJobFile(manifest.jobId, manifest.runId),
    paths.jobFile(manifest.jobId),
  ]) {
    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    return JobSchema.parse(JSON.parse(content));
  }
  throw new Error(
    `The job ${manifest.name} was trained for isn't in Architect, so the files it may use are unknown.`,
  );
}
