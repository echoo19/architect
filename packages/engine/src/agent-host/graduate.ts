import { createLlamaCppStudent, createStudent, isLoopbackUrl } from '@architect/adapters';
import { skillFiles } from '@architect/harness';
import {
  GuardError,
  PackageError,
  type Grants,
  type Harness,
  type StudentAdapter,
} from '@architect/shared';
import type { AgentJob } from '../agent/loop';
import { openAgentFiles, type AgentFiles, type OutputFolder } from '../files/agent-files';
import { grantedFiles } from '../graduates/bindings';
import { readPackageHarness } from '../graduates/harness';
import type { ActiveVersion } from '../graduates/open';
import type { AdapterServing, ServeRequest } from '../local-runtime';

/** An open graduate: everything its chats share, all from one version. */
export interface GraduateSession {
  readonly id: string;
  readonly name: string;
  /** The version that answers. Every reply records it. */
  readonly version: number;
  /** The version and installation it was opened with (`activeStamp`). */
  readonly stamp: string;
  readonly harness: Harness;
  /** What the agent loop reads of the job: the contract's business date and its output folder. */
  readonly job: AgentJob;
  readonly student: StudentAdapter;
  /**
   * The agent's folder, live: `data/` and `output/` are the folders this computer's installation
   * bound, and an approved change goes straight to its file.
   */
  readonly files: AgentFiles;
  readonly grants: Grants;
  /**
   * What the adapter runtime serves the version with (`ActiveVersion.adapter`): its student is
   * llama.cpp's, with this adapter at this scale on every request. Null without one.
   */
  readonly adapter: ServeRequest | null;
  /** The student's context window, which bounds how much of a chat it is shown. */
  readonly contextLength: number;
}

/**
 * What the agent loop reads of the job, from the version's contract: the date its records are as
 * of, and the `output/` folder this computer gives it, described as the contract describes it.
 */
function agentJob(active: ActiveVersion, output: OutputFolder | undefined): AgentJob {
  const { businessDate } = active.version.manifest.contract;
  return {
    ...(businessDate === undefined ? {} : { businessDate }),
    data:
      output === undefined
        ? {}
        : { output: output.description === undefined ? {} : { description: output.description } },
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

export interface SessionOptions {
  /** The quiet-mode CPU thread cap for a student on Ollama. */
  cpuThreads?: number;
  /** Serves a version that carries an adapter. Without it, such a version isn't opened. */
  adapters?: AdapterServing;
}

/**
 * The student that answers for the version. One without an adapter runs on the runtime its
 * installation names, as it always has. One with an adapter runs on llama.cpp, on the base from
 * Ollama's store with the adapter applied to every request (decision 041), and only once the base
 * is the build the adapter was trained on and the adapter is the file installed: a version with
 * an adapter never runs without it, nor with another's.
 */
async function studentFor(
  active: ActiveVersion,
  contextLength: number,
  options: SessionOptions,
): Promise<StudentAdapter> {
  const { model } = active;
  if (active.adapter === null) {
    return createStudent(
      { runtime: model.runtime, baseUrl: model.baseUrl, model: model.model, contextLength },
      options.cpuThreads === undefined ? {} : { cpuThreads: options.cpuThreads },
    );
  }
  const version = `Version ${active.version.version} of ${active.name}`;
  if (model.runtime !== 'ollama') {
    throw new GuardError(
      'permission',
      `${version} carries a LoRA adapter, which llama.cpp applies to its base from Ollama's model store, and its model here is set to ${model.runtime}. Set its model to ${active.version.manifest.model.base.name} on Ollama to run it.`,
    );
  }
  if (options.adapters === undefined) {
    throw new GuardError(
      'permission',
      `${version} carries a LoRA adapter, and nothing here serves adapters, so it wasn't opened.`,
    );
  }
  const { problems } = await options.adapters.survey(active.adapter);
  const wrong = problems.find(
    (problem) => problem.code === 'base_mismatch' || problem.code === 'adapter_unusable',
  );
  if (wrong) {
    throw new GuardError('permission', `${version} wasn't opened. ${wrong.message} ${wrong.hint}`);
  }
  return createLlamaCppStudent(options.adapters.access(active.adapter));
}

/**
 * Opens a graduate's active version for chats, from its own folder and this computer's
 * installation, and checks that it runs here before anything else happens: the harness is the
 * one the version was made with, the model runs on this computer (a student endpoint that isn't
 * loopback is refused before a single request), a version's adapter is served with it, and every
 * required folder is bound and granted. The student is built without an API key, since a local
 * runtime needs none.
 */
export async function openGraduateSession(
  active: ActiveVersion,
  options: SessionOptions = {},
): Promise<GraduateSession> {
  const { manifest } = active.version;
  const { model } = active;
  if (!isLoopbackUrl(model.baseUrl)) {
    throw new GuardError(
      'network',
      `${active.name} is set to run its model at ${new URL(model.baseUrl).host}, which isn't this computer. Graduates only run on a local model, so it wasn't opened.`,
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
  const student = await studentFor(active, contextLength, options);
  // With no folder bound to data/, no data file is open: never the version's own folder.
  const dataFolder = active.bindings['data'];
  const files = dataFolder === undefined ? [] : grantedFiles(manifest.contract, active.grants);
  const output = outputFolder(active);
  return {
    id: active.graduateId,
    name: active.name,
    version: active.version.version,
    stamp: active.stamp,
    harness,
    job: agentJob(active, output),
    student,
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
