import { createStudent, isLoopbackUrl } from '@architect/adapters';
import { skillFiles } from '@architect/harness';
import {
  ADAPTER_RUNTIMES,
  GuardError,
  PackageError,
  type DataFile,
  type Grants,
  type Harness,
  type Job,
  type JobContract,
  type ModelBinding,
  type StudentAdapter,
} from '@architect/shared';
import { openAgentFiles, type AgentFiles, type OutputFolder } from '../files/agent-files';
import { grantedFiles } from '../graduates/bindings';
import { readPackageHarness } from '../graduates/harness';
import type { ActiveVersion } from '../graduates/open';
import type { ServeRequest } from '../local-runtime';

/** An open graduate: everything its chats share, all from one version. */
export interface GraduateSession {
  readonly id: string;
  readonly name: string;
  /** The version that answers. Every reply records it. */
  readonly version: number;
  /** The version and installation it was opened with (`activeStamp`). */
  readonly stamp: string;
  readonly harness: Harness;
  /** The job as the agent loop reads it: the contract's files as this computer granted them. */
  readonly job: Job;
  readonly student: StudentAdapter;
  /**
   * The agent's folder, live: `data/` and `output/` are the folders this computer's installation
   * bound, and an approved change goes straight to its file.
   */
  readonly files: AgentFiles;
  readonly grants: Grants;
  /** What the adapter runtime loads for the version (`ActiveVersion.adapter`); null without one. */
  readonly adapter: ServeRequest | null;
  /** The student's context window, which bounds how much of a chat it is shown. */
  readonly contextLength: number;
}

/**
 * The job the agent loop takes, made from the contract. The loop reads only the data files, the
 * output folder and the business date; its training settings are required by the type and left
 * inert: a graduate never trains, and the agent host can't load mentor code.
 */
function runtimeJob(
  contract: JobContract,
  files: DataFile[],
  output: OutputFolder | undefined,
  grants: Grants,
  model: ModelBinding,
  contextLength: number,
  label: string,
  createdAt: string,
): Job {
  return {
    format: 1,
    id: contract.jobId,
    name: contract.name,
    description: contract.description,
    ...(contract.summary === undefined ? {} : { summary: contract.summary }),
    does: contract.capabilities.does,
    doesNot: contract.capabilities.doesNot,
    createdAt,
    ...(contract.businessDate === undefined ? {} : { businessDate: contract.businessDate }),
    taskTypes: contract.capabilities.taskTypes,
    data: {
      files,
      ...(output === undefined
        ? {}
        : { output: output.description === undefined ? {} : { description: output.description } }),
    },
    permissions: { writes: grants.writes, unseenFiles: 'never' },
    checker: { kind: 'builtin' },
    requirements: {
      passRate: contract.acceptance.passRate,
      ...(contract.acceptance.p95LatencyMs === undefined
        ? {}
        : { p95LatencyMs: contract.acceptance.p95LatencyMs }),
    },
    budget: { maxRounds: 1, maxMentorUsd: 0, maxWallMinutes: 1 },
    mentor: { kind: 'coding_agent', agent: 'claude_code', label: 'None: a graduate runs alone' },
    student: { label, local: { ...model, contextLength }, trainOn: 'local' },
    startingHarness: { kind: 'blank' },
    splits: { seed: 0, calibration: 0, train: 1, dev: 1, test: 1 },
    evaluation: {
      trainBatch: 1,
      minDevGain: 1,
      maxTypeRegression: 0,
      devRepeats: 1,
      patience: 1,
    },
  };
}

/**
 * The `output/` folder this computer gives the version: the folder its installation bound to
 * `output`, when the contract allows one and the user granted changing it. Without a binding
 * and that grant, the agent has no output folder at all.
 */
function outputFolder(active: ActiveVersion): OutputFolder | undefined {
  const allowed = active.version.manifest.contract.outputs.folder;
  const dir = active.bindings['output'];
  if (allowed === undefined || dir === undefined) return undefined;
  if (active.grants.resources['output'] !== 'read_write') return undefined;
  return {
    ...(allowed.description === undefined ? {} : { description: allowed.description }),
    dir,
  };
}

/**
 * Opens a graduate's active version for chats, from its own folder and this computer's
 * installation, and checks that it runs here before anything else happens: the harness is the
 * one the version was made with, the model runs on this computer (a student endpoint that isn't
 * loopback is refused before a single request), and every required folder is bound and granted.
 * The student is built without an API key, since a local runtime needs none.
 */
export async function openGraduateSession(
  active: ActiveVersion,
  cpuThreads?: number,
): Promise<GraduateSession> {
  const { manifest } = active.version;
  const { model } = active;
  if (!isLoopbackUrl(model.baseUrl)) {
    throw new GuardError(
      'network',
      `${active.name} is set to run its model at ${new URL(model.baseUrl).host}, which isn't this computer. Graduates only run on a local model, so it wasn't opened.`,
    );
  }
  if (
    manifest.model.adapter !== undefined &&
    !ADAPTER_RUNTIMES.some((runtime) => runtime === model.runtime)
  ) {
    throw new Error(
      `Version ${active.version.version} of ${active.name} carries a LoRA adapter, which ${model.runtime} can't load; it needs ${ADAPTER_RUNTIMES.join(' or ')}. It wasn't opened, so it never runs without its adapter.`,
    );
  }
  let harness: Harness;
  try {
    harness = await readPackageHarness(active.dir, manifest);
  } catch (error) {
    if (!(error instanceof PackageError)) throw error;
    throw new PackageError(error.code, [
      `Version ${active.version.version} of ${active.name} has a harness that doesn't match the one it was made with, so it wasn't opened.`,
      ...error.problems,
    ]);
  }
  for (const resource of manifest.resources) {
    if (!resource.required) continue;
    const files = resource.files.map((file) => file.name).join(', ');
    if (active.bindings[resource.name] === undefined) {
      throw new Error(
        `${active.name} needs a folder for ${resource.name}/ before it can run${files ? `: one that holds ${files}` : ''}.`,
      );
    }
    if ((active.grants.resources[resource.name] ?? 'none') === 'none') {
      throw new Error(
        `${active.name} can't open ${resource.name}/ until you allow it in its permissions.`,
      );
    }
  }
  const contextLength = manifest.model.inference.contextLength;
  // With no folder bound to data/, no data file is open: never the version's own folder.
  const dataFolder = active.bindings['data'];
  const files = dataFolder === undefined ? [] : grantedFiles(manifest.contract, active.grants);
  const output = outputFolder(active);
  const job = runtimeJob(
    manifest.contract,
    files,
    output,
    active.grants,
    model,
    contextLength,
    manifest.model.label,
    manifest.identity.createdAt,
  );
  return {
    id: active.graduateId,
    name: active.name,
    version: active.version.version,
    stamp: active.stamp,
    harness,
    job,
    student: createStudent(
      { runtime: model.runtime, baseUrl: model.baseUrl, model: model.model, contextLength },
      cpuThreads === undefined ? {} : { cpuThreads },
    ),
    files: await openAgentFiles({
      dataDir: dataFolder ?? active.dir,
      files,
      ...(output === undefined ? {} : { output }),
      skills: skillFiles(harness),
      mode: 'live',
    }),
    grants: active.grants,
    adapter: active.adapter,
    contextLength,
  };
}
