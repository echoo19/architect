import { readFile } from 'node:fs/promises';
import { arch, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import { createLlamaCppStudent, isLoopbackUrl } from '@architect/adapters';
import {
  ADAPTER_RUNTIMES,
  AdapterError,
  PackageError,
  type FolderProblem,
  type Harness,
  type HarnessTool,
  type InstallCheck,
  type InstallStatus,
  type Machine,
  type ModelBinding,
  type ModelProblem,
  type PackageManifest,
  type StudentAdapter,
} from '@architect/shared';
import { parseCsv } from '../data/csv';
import {
  shortDigest,
  type AdapterServing,
  type LocalRuntimeError,
  type LocalRuntimeErrorCode,
  type ServeRequest,
} from '../local-runtime';
import type { DataPaths } from '../loop/paths';
import type { StoredChecks, StoredInstallation, StoredVersion } from '../store/records';
import { absoluteFolder } from './bindings';
import { readPackageHarness } from './harness';
import { adapterRequest, serveRequestFor } from './open';
import { exists } from './versions';

/** Where Architect runs graduates. Anything else, a Raspberry Pi included, is reported as such. */
export const SUPPORTED_PLATFORMS: readonly { os: string; arch: string }[] = [
  { os: 'win32', arch: 'x64' },
  { os: 'win32', arch: 'arm64' },
  { os: 'darwin', arch: 'x64' },
  { os: 'darwin', arch: 'arm64' },
];

export function thisMachine(): Machine {
  return { os: platform(), arch: arch(), memoryBytes: totalmem() };
}

export interface CheckDeps {
  paths: DataPaths;
  machine(): Machine;
  /** Why a tool's code doesn't load in the sandbox, or null. Only its top level runs. */
  toolLoadProblem(tool: HarnessTool): Promise<string | null>;
  /** A student on this computer's runtime, for the model checks. Never a hosted endpoint. */
  createStudent(binding: ModelBinding, contextLength: number): StudentAdapter;
  /** The adapter runtime, which checks and serves a version that carries an adapter. */
  adapters: AdapterServing;
  now(): string;
}

export interface CheckOptions {
  /** Send the model one short request, which loads it. */
  loadModel: boolean;
}

/** A problem a check found, and how much it stands in the way. */
interface Finding {
  level: 'blocked' | 'needs_attention';
  reason: string;
}

const gb = (bytes: number): string => `${Math.round(bytes / 1024 ** 3)} GB`;

function compatibility(
  manifest: PackageManifest,
  model: ModelBinding,
  machine: Machine,
): { check: InstallCheck; findings: Finding[] } {
  const findings: Finding[] = [];
  let modelProblem: ModelProblem | undefined;
  const here = `${machine.os}/${machine.arch}`;
  const supported = SUPPORTED_PLATFORMS.some(
    (platform) => platform.os === machine.os && platform.arch === machine.arch,
  );
  if (!supported) {
    findings.push({
      level: 'blocked',
      reason: `This computer is ${here}. Architect runs graduates on Windows and macOS (x64 and arm64), so it can't run here; a smaller device would need its own student, trained and tested on it.`,
    });
  } else if (
    manifest.requirements.tested.length > 0 &&
    !manifest.requirements.tested.some(
      (tested) => tested.os === machine.os && tested.arch === machine.arch,
    )
  ) {
    const tested = manifest.requirements.tested
      .map((config) => `${config.os}/${config.arch} with ${config.backend}`)
      .join(', ');
    findings.push({
      level: 'needs_attention',
      reason: `It was tested on ${tested}; this computer is ${here}. The author's results don't cover this computer.`,
    });
  }
  const needed = manifest.requirements.minimum.memoryBytes;
  if (needed !== undefined && needed > machine.memoryBytes) {
    findings.push({
      level: 'blocked',
      reason: `Its model needs about ${gb(needed)} of memory, and this computer has ${gb(machine.memoryBytes)}.`,
    });
  }
  const { compatible } = manifest.model.runtime;
  if (manifest.model.adapter) {
    // llama.cpp serves the adapter on the base from Ollama's store (decision 041).
    if (!compatible.some((runtime) => (ADAPTER_RUNTIMES as readonly string[]).includes(runtime))) {
      findings.push({
        level: 'blocked',
        reason: `It carries a LoRA adapter for ${compatible.join(' or ')}, and this version of Architect serves adapters only with ${ADAPTER_RUNTIMES.join(' or ')}.`,
      });
    }
    if (model.runtime !== 'ollama') {
      modelProblem = 'wrong_runtime';
      findings.push({
        level: 'needs_attention',
        reason: `It carries a LoRA adapter, which llama.cpp applies to its base from Ollama's model store, and its model here is set to ${model.runtime}. Set its model to ${manifest.model.base.name} on Ollama.`,
      });
    }
  } else if (!compatible.includes(model.runtime)) {
    findings.push({
      level: 'blocked',
      reason: `It runs on ${compatible.join(' or ')}, and this computer serves its model with ${model.runtime}.`,
    });
  }
  if (!isLoopbackUrl(model.baseUrl)) {
    findings.push({
      level: 'blocked',
      reason: `Its model is set to run at ${new URL(model.baseUrl).host}, which isn't this computer. A graduate only runs on a local model.`,
    });
  }
  const serving = manifest.model.adapter
    ? "llama.cpp with its adapter, on its base from Ollama's store"
    : `${model.runtime} at ${new URL(model.baseUrl).host}`;
  return {
    check: {
      id: 'compatibility',
      kind: 'compatibility',
      status: findings.length === 0 ? 'passed' : 'failed',
      detail:
        findings.length === 0
          ? `${here}, ${gb(machine.memoryBytes)} of memory, ${serving}.`
          : findings.map((finding) => finding.reason).join(' '),
      ...(modelProblem === undefined ? {} : { modelProblem }),
    },
    findings,
  };
}

async function harnessCheck(
  dir: string,
  manifest: PackageManifest,
): Promise<{ check: InstallCheck; harness: Harness | null; findings: Finding[] }> {
  try {
    let harness: Harness;
    try {
      harness = await readPackageHarness(dir, manifest);
    } catch (error) {
      if (!(error instanceof PackageError)) throw error;
      const reason = `Its harness isn't the one the graduate was tested with. ${error.problems.join(' ')}`;
      return {
        check: { id: 'harness-valid', kind: 'harness_valid', status: 'failed', detail: reason },
        harness: null,
        findings: [{ level: 'blocked', reason }],
      };
    }
    return {
      check: {
        id: 'harness-valid',
        kind: 'harness_valid',
        status: 'passed',
        detail: `Harness version ${manifest.harness.version}, as tested.`,
      },
      harness,
      findings: [],
    };
  } catch (error) {
    const reason = `Its harness doesn't load: ${error instanceof Error ? error.message : String(error)}`;
    return {
      check: { id: 'harness-valid', kind: 'harness_valid', status: 'failed', detail: reason },
      harness: null,
      findings: [{ level: 'blocked', reason }],
    };
  }
}

async function toolsCheck(
  deps: CheckDeps,
  harness: Harness | null,
): Promise<{ check: InstallCheck; findings: Finding[] }> {
  if (harness === null) {
    return {
      check: {
        id: 'tools-load',
        kind: 'tools_load',
        status: 'skipped',
        detail: 'The harness did not load.',
        skipped: 'after_failure',
      },
      findings: [],
    };
  }
  const findings: Finding[] = [];
  for (const tool of harness.tools) {
    let problem: string | null;
    try {
      problem = await deps.toolLoadProblem(tool);
    } catch (error) {
      findings.push({
        level: 'needs_attention',
        reason: `The tool sandbox stopped while checking ${tool.name}: ${error instanceof Error ? error.message : String(error)} Check again.`,
      });
      continue;
    }
    if (problem !== null) {
      findings.push({ level: 'blocked', reason: `Its tool ${tool.name} doesn't load: ${problem}` });
    }
  }
  return {
    check: {
      id: 'tools-load',
      kind: 'tools_load',
      status: findings.length === 0 ? 'passed' : 'failed',
      detail:
        findings.length === 0
          ? `${harness.tools.length} tool${harness.tools.length === 1 ? '' : 's'} loaded.`
          : findings.map((finding) => finding.reason).join(' '),
    },
    findings,
  };
}

async function resourcesCheck(
  paths: DataPaths,
  manifest: PackageManifest,
  installation: StoredInstallation,
): Promise<{ check: InstallCheck; findings: Finding[] }> {
  const findings: Finding[] = [];
  const folders: FolderProblem[] = [];
  /** A folder that isn't ready: why, in words and as the screens need it. */
  const wanting = (name: string, problem: FolderProblem['problem'], reason: string) => {
    findings.push({ level: 'needs_attention', reason });
    if (!folders.some((entry) => entry.name === name && entry.problem === problem)) {
      folders.push({ name, problem });
    }
  };
  for (const resource of manifest.resources) {
    const { name } = resource;
    const stored = installation.bindings[name];
    const grant = installation.grants.resources[name] ?? 'none';
    const files = resource.files.map((file) => file.name).join(', ');
    if (stored === undefined) {
      if (resource.required) {
        wanting(
          name,
          'not_chosen',
          `Choose a folder for ${name}/${files ? `: it should hold ${files}` : ''}.`,
        );
      }
      continue;
    }
    if (resource.required && grant === 'none') {
      wanting(
        name,
        'not_allowed',
        `${name}/ has a folder, but the agent isn't allowed to open it.`,
      );
    }
    const folder = absoluteFolder(paths, stored);
    if (!(await exists(folder))) {
      wanting(name, 'missing', `The folder chosen for ${name}/ (${folder}) isn't there.`);
      continue;
    }
    for (const file of resource.files) {
      const path = join(folder, file.name);
      if (!(await exists(path))) {
        wanting(name, 'files', `${name}/ has no ${file.name}.`);
        continue;
      }
      if (file.kind !== 'table' || file.columns === undefined) continue;
      let columns: string[];
      try {
        columns = parseCsv(file.name, await readFile(path, 'utf8')).columns;
      } catch (error) {
        wanting(
          name,
          'files',
          `${name}/${file.name} can't be read as a table: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      const missing = file.columns.filter((column) => !columns.includes(column));
      if (missing.length > 0) {
        wanting(
          name,
          'files',
          `${name}/${file.name} has no ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}, which the graduate was trained with.`,
        );
      }
    }
  }
  return {
    check: {
      id: 'resources-bound',
      kind: 'resources_bound',
      status: findings.length === 0 ? 'passed' : 'failed',
      detail:
        findings.length === 0
          ? 'Every folder is chosen and holds the files it should.'
          : findings.map((finding) => finding.reason).join(' '),
      ...(folders.length === 0 ? {} : { folders }),
    },
    findings,
  };
}

interface ModelResult {
  checks: InstallCheck[];
  findings: Finding[];
  firstReplyMs?: number;
}

/** A check not tried because one it needs failed first. */
const skipped = (id: string, kind: string, detail: string): InstallCheck => ({
  id,
  kind,
  status: 'skipped',
  detail,
  skipped: 'after_failure',
});

/** The model-responds check when no request is sent: not asked to, or the model isn't there. */
function respondsSkipped(
  options: CheckOptions,
  why = 'Skipped: the model is not available.',
): InstallCheck {
  return options.loadModel
    ? skipped('model-responds', 'model_responds', why)
    : {
        id: 'model-responds',
        kind: 'model_responds',
        status: 'skipped',
        detail: 'Not asked for.',
        skipped: 'not_asked',
      };
}

/**
 * One short request, timed from the first byte sent to the end of the reply, loading included.
 * The model is unloaded again afterwards whether or not it answered.
 */
async function respondsCheck(
  student: StudentAdapter,
): Promise<{ check: InstallCheck; findings: Finding[]; firstReplyMs?: number }> {
  const findings: Finding[] = [];
  const started = Date.now();
  let check: InstallCheck;
  let firstReplyMs: number | undefined;
  try {
    for await (const event of student.chat({
      messages: [{ role: 'user', content: 'Reply with the word ready.' }],
      tools: [],
      decoding: {
        temperature: 1,
        topP: 0.95,
        topK: 64,
        maxSteps: 1,
        maxOutputTokens: 256,
        thinking: 'low',
      },
      seed: 1,
    })) {
      if (event.type === 'done') break;
    }
    firstReplyMs = Date.now() - started;
    check = {
      id: 'model-responds',
      kind: 'model_responds',
      status: 'passed',
      detail: `Answered in ${(firstReplyMs / 1000).toFixed(1)} s, loading included.`,
      ms: firstReplyMs,
    };
  } catch (error) {
    const reason = `The model didn't answer a short request: ${error instanceof Error ? error.message : String(error)}`;
    findings.push({ level: 'needs_attention', reason });
    check = { id: 'model-responds', kind: 'model_responds', status: 'failed', detail: reason };
  }
  try {
    await student.release();
  } catch (error) {
    findings.push({
      level: 'needs_attention',
      reason: `The model stayed loaded after the check: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return { check, findings, ...(firstReplyMs === undefined ? {} : { firstReplyMs }) };
}

/** A version without an adapter, on the runtime its installation names. */
async function runtimeModelChecks(
  deps: Pick<CheckDeps, 'createStudent'>,
  manifest: PackageManifest,
  model: ModelBinding,
  options: CheckOptions,
): Promise<ModelResult> {
  const student = deps.createStudent(model, manifest.model.inference.contextLength);
  const findings: Finding[] = [];
  let available: InstallCheck;
  try {
    const described = await student.describe();
    // A different build than the author's only needs attention: it may answer differently.
    const pinned = manifest.model.base.digest;
    // The pinned build took the final test only when the author tested on a local model; a
    // version tested on a hosted copy was made for this build, not tested on it.
    const tested = manifest.evidence.provenance?.testedOn === 'local';
    if (pinned !== undefined && described.digest !== undefined && described.digest !== pinned) {
      const reason = `${model.runtime} serves a different build of ${manifest.model.base.name} (digest ${shortDigest(described.digest)}) than the one ${tested ? 'tested' : 'it was made for'} (${shortDigest(pinned)}).`;
      findings.push({ level: 'needs_attention', reason });
      available = {
        id: 'model-available',
        kind: 'model_available',
        status: 'failed',
        detail: reason,
        sameBuild: false,
        modelProblem: 'other_build',
      };
    } else {
      const same = pinned !== undefined && described.digest === pinned;
      available = {
        id: 'model-available',
        kind: 'model_available',
        status: 'passed',
        detail: same
          ? `${model.model} on ${model.runtime}, the same build ${tested ? 'that was tested' : 'it was made for'}.`
          : `${model.model} on ${model.runtime}.`,
        // Unknown unless both the package and the runtime name a build, and the test ran on it.
        ...(same && tested ? { sameBuild: true } : {}),
      };
    }
  } catch (error) {
    const size = manifest.model.base.sizeBytes;
    const reason = `${model.runtime} at ${new URL(model.baseUrl).host} can't serve ${model.model}: ${error instanceof Error ? error.message : String(error)}${size === undefined ? '' : ` Downloading ${manifest.model.base.name} takes about ${gb(size)}.`}`;
    findings.push({ level: 'needs_attention', reason });
    available = {
      id: 'model-available',
      kind: 'model_available',
      status: 'failed',
      detail: reason,
      modelProblem:
        error instanceof AdapterError && error.code === 'not_found'
          ? 'not_downloaded'
          : 'unavailable',
    };
  }
  if (!options.loadModel || available.status === 'failed') {
    return { checks: [available, respondsSkipped(options)], findings };
  }
  const responds = await respondsCheck(student);
  return {
    checks: [available, responds.check],
    findings: [...findings, ...responds.findings],
    ...(responds.firstReplyMs === undefined ? {} : { firstReplyMs: responds.firstReplyMs }),
  };
}

/**
 * How much each problem the adapter runtime finds stands in the way. What the user can fix here
 * (install or update llama.cpp, download the base) needs attention; a base of another build, or an
 * adapter file that isn't the one installed, blocks the version until it is put right.
 */
const ADAPTER_PROBLEM_LEVELS: Record<LocalRuntimeErrorCode, Finding['level']> = {
  binary_not_found: 'needs_attention',
  binary_unusable: 'needs_attention',
  model_not_found: 'needs_attention',
  model_unusable: 'needs_attention',
  base_mismatch: 'blocked',
  adapter_unusable: 'blocked',
  gpu_busy: 'needs_attention',
  out_of_memory: 'needs_attention',
  start_failed: 'needs_attention',
  busy: 'needs_attention',
};

const SERVER_PROBLEMS: ReadonlySet<LocalRuntimeErrorCode> = new Set([
  'binary_not_found',
  'binary_unusable',
]);

/**
 * What a base the adapter runtime turned down needs, worst first: the exact build under a name of
 * its own, a download, or a model that reads as weights at all. A changed adapter file, or a GPU
 * that is busy, is no problem with the base.
 */
const BASE_PROBLEMS: readonly [LocalRuntimeErrorCode, ModelProblem][] = [
  ['base_mismatch', 'other_build'],
  ['model_not_found', 'not_downloaded'],
  ['model_unusable', 'unavailable'],
];

function baseProblem(problems: readonly LocalRuntimeError[]): ModelProblem | undefined {
  return BASE_PROBLEMS.find(([code]) => problems.some((problem) => problem.code === code))?.[1];
}

/** A problem of the adapter runtime in words that say what to do, with the download a base needs. */
function adapterReason(
  problem: LocalRuntimeError,
  manifest: PackageManifest,
  request: ServeRequest,
): string {
  const size = manifest.model.base.sizeBytes;
  if (problem.code === 'model_not_found') {
    const download = size === undefined ? '' : ` (about ${gb(size)})`;
    const build = request.baseDigest ?? 'its adapter was trained on';
    return `Its base, ${request.model}, isn't in Ollama's model folder on this computer. Download ${request.model}${download}, the build whose weights are ${build}: its adapter loads on no other.`;
  }
  if (problem.code === 'base_mismatch' && size !== undefined) {
    return `${problem.message} ${problem.hint} That build is about ${gb(size)}.`;
  }
  return `${problem.message} ${problem.hint}`;
}

/**
 * A version with an adapter: llama-server and its build, the base in Ollama's store and its
 * build, and the adapter file as installed, each found by the adapter runtime without loading
 * anything; then, when asked, one short request through llama.cpp with the adapter applied.
 */
async function adapterModelChecks(
  deps: Pick<CheckDeps, 'adapters'>,
  manifest: PackageManifest,
  request: ServeRequest,
  options: CheckOptions,
): Promise<ModelResult> {
  const survey = await deps.adapters.survey(request);
  const reasonOf = (problem: LocalRuntimeError) => adapterReason(problem, manifest, request);
  const findings = survey.problems.map((problem): Finding => ({
    level: ADAPTER_PROBLEM_LEVELS[problem.code],
    reason: reasonOf(problem),
  }));
  const serverProblems = survey.problems.filter((problem) => SERVER_PROBLEMS.has(problem.code));
  const modelProblems = survey.problems.filter((problem) => !SERVER_PROBLEMS.has(problem.code));
  const runtime: InstallCheck = survey.server
    ? {
        id: 'adapter-runtime',
        kind: 'adapter_runtime',
        status: 'passed',
        detail: `llama-server build ${survey.server.build}, at ${survey.server.file}.`,
        build: survey.server.build,
      }
    : {
        id: 'adapter-runtime',
        kind: 'adapter_runtime',
        status: 'failed',
        detail: serverProblems.map(reasonOf).join(' '),
      };
  const problem = baseProblem(modelProblems);
  const available: InstallCheck =
    survey.base && modelProblems.length === 0
      ? {
          id: 'model-available',
          kind: 'model_available',
          status: 'passed',
          detail: `${request.model} in Ollama's store, the build its adapter was trained on (${shortDigest(survey.base.digest)}), and its adapter as installed.`,
          sameBuild: true,
        }
      : {
          id: 'model-available',
          kind: 'model_available',
          status: 'failed',
          detail: modelProblems.map(reasonOf).join(' '),
          ...(problem === 'other_build' ? { sameBuild: false } : {}),
          ...(problem === undefined ? {} : { modelProblem: problem }),
        };
  if (!options.loadModel || findings.length > 0) {
    const why =
      modelProblems.length > 0
        ? 'Skipped: the model is not available.'
        : "Skipped: llama-server can't run it yet.";
    return { checks: [runtime, available, respondsSkipped(options, why)], findings };
  }
  const responds = await respondsCheck(createLlamaCppStudent(deps.adapters.access(request)));
  return {
    checks: [runtime, available, responds.check],
    findings: responds.findings,
    ...(responds.firstReplyMs === undefined ? {} : { firstReplyMs: responds.firstReplyMs }),
  };
}

/**
 * The model checks for a version's files wherever they are, installed or staged for import:
 * skipped once a check before them has blocked it, else through llama.cpp for a version with an
 * adapter (`request`) and on the runtime its model binding names for one without.
 */
async function servedChecks(
  deps: Pick<CheckDeps, 'createStudent' | 'adapters'>,
  manifest: PackageManifest,
  model: ModelBinding,
  request: ServeRequest | null,
  options: CheckOptions,
  blockedAlready: boolean,
): Promise<ModelResult> {
  // An adapter is served on its base from Ollama's store; compatibility named any other binding.
  const servable = request === null || model.runtime === 'ollama';
  if (blockedAlready || !isLoopbackUrl(model.baseUrl) || !servable) {
    const detail = 'Skipped: this computer cannot run it as it is.';
    return {
      checks: [
        ...(request === null ? [] : [skipped('adapter-runtime', 'adapter_runtime', detail)]),
        skipped('model-available', 'model_available', detail),
        skipped('model-responds', 'model_responds', detail),
      ],
      findings: [],
    };
  }
  return request === null
    ? runtimeModelChecks(deps, manifest, model, options)
    : adapterModelChecks(deps, manifest, request, options);
}

async function modelChecks(
  deps: CheckDeps,
  version: StoredVersion,
  installation: StoredInstallation,
  options: CheckOptions,
  blockedAlready: boolean,
): Promise<ModelResult> {
  const request = serveRequestFor(
    version.manifest.identity.name,
    version,
    deps.paths.fromStored(version.path),
    installation,
  );
  return servedChecks(deps, version.manifest, installation.model, request, options, blockedAlready);
}

function statusOf(findings: readonly Finding[]): InstallStatus {
  if (findings.some((finding) => finding.level === 'blocked')) return 'blocked';
  return findings.length > 0 ? 'needs_attention' : 'ready';
}

/** What an import can know about this computer before it installs anything. */
export interface FitResult {
  machine: Machine;
  /**
   * The compatibility check, llama.cpp's for a package with an adapter, and the base model's
   * availability, as installation checks run them.
   */
  checks: InstallCheck[];
  status: InstallStatus;
  reasons: string[];
}

/**
 * Whether this computer can run a package, and whether it has what serves its model, found before
 * it is installed: the compatibility check, then the model checks exactly as the installation
 * checks run them, short of a request. Nothing loads: the runtime only describes the model, and
 * for an adapter, llama-server, the base in Ollama's store and the adapter file in `dir` (where
 * the package is staged) are looked at.
 */
export async function fitChecks(
  deps: Pick<CheckDeps, 'machine' | 'createStudent' | 'adapters'>,
  manifest: PackageManifest,
  model: ModelBinding,
  dir: string,
): Promise<FitResult> {
  const machine = deps.machine();
  const fit = compatibility(manifest, model, machine);
  const blocked = fit.findings.some((finding) => finding.level === 'blocked');
  const request = adapterRequest(
    `${manifest.identity.name} v${manifest.identity.version}`,
    manifest,
    dir,
    model.model,
  );
  const served = await servedChecks(deps, manifest, model, request, { loadModel: false }, blocked);
  const looked = served.checks.filter((check) => check.kind !== 'model_responds');
  const findings = [...fit.findings, ...served.findings];
  return {
    machine,
    checks: [fit.check, ...looked],
    status: statusOf(findings),
    reasons: findings.map((finding) => finding.reason),
  };
}

/**
 * Checks one version where it is installed: whether this computer can run it at all, then the
 * package's smoke checks. The result is this computer's, labelled so, and is never mixed with
 * the author's evidence. Blocked means it can't run here; needs attention means the user can fix
 * something (a folder to bind, a model to download); ready means every check passed.
 */
export async function checkInstallation(
  deps: CheckDeps,
  version: StoredVersion,
  installation: StoredInstallation,
  options: CheckOptions,
): Promise<StoredChecks> {
  const { manifest } = version;
  const dir = deps.paths.fromStored(version.path);
  const machine = deps.machine();
  const fit = compatibility(manifest, installation.model, machine);
  const harness = await harnessCheck(dir, manifest);
  const tools = await toolsCheck(deps, harness.harness);
  const resources = await resourcesCheck(deps.paths, manifest, installation);
  const blocking = [...fit.findings, ...harness.findings, ...tools.findings].some(
    (finding) => finding.level === 'blocked',
  );
  const model = await modelChecks(deps, version, installation, options, blocking);
  const findings = [
    ...fit.findings,
    ...harness.findings,
    ...tools.findings,
    ...resources.findings,
    ...model.findings,
  ];
  const status = statusOf(findings);
  return {
    graduateId: version.graduateId,
    version: version.version,
    status,
    reasons: findings.map((finding) => finding.reason),
    checks: [fit.check, harness.check, tools.check, resources.check, ...model.checks],
    machine,
    measurements: model.firstReplyMs === undefined ? {} : { firstReplyMs: model.firstReplyMs },
    checkedAt: deps.now(),
  };
}
