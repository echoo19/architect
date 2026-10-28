import { readFile } from 'node:fs/promises';
import { arch, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import { isLoopbackUrl } from '@architect/adapters';
import { hashHarness, readHarness } from '@architect/harness';
import {
  ADAPTER_RUNTIMES,
  type Harness,
  type HarnessTool,
  type InstallCheck,
  type InstallStatus,
  type Machine,
  type ModelBinding,
  type PackageManifest,
  type StudentAdapter,
} from '@architect/shared';
import { parseCsv } from '../data/csv';
import type { DataPaths } from '../loop/paths';
import type { StoredChecks, StoredInstallation, StoredVersion } from '../store/records';
import { absoluteFolder } from './bindings';
import { HARNESS_DIR } from './build';
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
  if (!compatible.includes(model.runtime)) {
    findings.push({
      level: 'blocked',
      reason: `It runs on ${compatible.join(' or ')}, and this computer serves its model with ${model.runtime}.`,
    });
  }
  if (manifest.model.adapter && !ADAPTER_RUNTIMES.some((runtime) => runtime === model.runtime)) {
    findings.push({
      level: 'blocked',
      reason: `It carries a LoRA adapter, which ${model.runtime} can't load; it needs ${ADAPTER_RUNTIMES.join(' or ')}.`,
    });
  }
  if (!isLoopbackUrl(model.baseUrl)) {
    findings.push({
      level: 'blocked',
      reason: `Its model is set to run at ${new URL(model.baseUrl).host}, which isn't this computer. A graduate only runs on a local model.`,
    });
  }
  return {
    check: {
      id: 'compatibility',
      kind: 'compatibility',
      status: findings.length === 0 ? 'passed' : 'failed',
      detail:
        findings.length === 0
          ? `${here}, ${gb(machine.memoryBytes)} of memory, ${model.runtime} at ${new URL(model.baseUrl).host}.`
          : findings.map((finding) => finding.reason).join(' '),
    },
    findings,
  };
}

async function harnessCheck(
  dir: string,
  manifest: PackageManifest,
): Promise<{ check: InstallCheck; harness: Harness | null; findings: Finding[] }> {
  try {
    const harness = await readHarness(join(dir, HARNESS_DIR));
    if (hashHarness(harness) !== manifest.harness.hash) {
      const reason = "Its harness isn't the one the graduate was tested with: the hashes differ.";
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
  for (const resource of manifest.resources) {
    const stored = installation.bindings[resource.name];
    const grant = installation.grants.resources[resource.name] ?? 'none';
    const files = resource.files.map((file) => file.name).join(', ');
    if (stored === undefined) {
      if (resource.required) {
        findings.push({
          level: 'needs_attention',
          reason: `Choose a folder for ${resource.name}/${files ? `: it should hold ${files}` : ''}.`,
        });
      }
      continue;
    }
    if (resource.required && grant === 'none') {
      findings.push({
        level: 'needs_attention',
        reason: `${resource.name}/ is bound but not granted, so the agent can't open it.`,
      });
    }
    const folder = absoluteFolder(paths, stored);
    if (!(await exists(folder))) {
      findings.push({
        level: 'needs_attention',
        reason: `The folder bound to ${resource.name}/ (${folder}) isn't there.`,
      });
      continue;
    }
    for (const file of resource.files) {
      const path = join(folder, file.name);
      if (!(await exists(path))) {
        findings.push({
          level: 'needs_attention',
          reason: `${resource.name}/ has no ${file.name}.`,
        });
        continue;
      }
      if (file.kind !== 'table' || file.columns === undefined) continue;
      let columns: string[];
      try {
        columns = parseCsv(file.name, await readFile(path, 'utf8')).columns;
      } catch (error) {
        findings.push({
          level: 'needs_attention',
          reason: `${resource.name}/${file.name} can't be read as a table: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      const missing = file.columns.filter((column) => !columns.includes(column));
      if (missing.length > 0) {
        findings.push({
          level: 'needs_attention',
          reason: `${resource.name}/${file.name} has no ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}, which the graduate was trained with.`,
        });
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
          ? 'Every folder is bound and holds the files it should.'
          : findings.map((finding) => finding.reason).join(' '),
    },
    findings,
  };
}

async function modelChecks(
  deps: CheckDeps,
  manifest: PackageManifest,
  installation: StoredInstallation,
  options: CheckOptions,
  blockedAlready: boolean,
): Promise<{ checks: InstallCheck[]; findings: Finding[]; firstReplyMs?: number }> {
  const { model } = installation;
  if (blockedAlready || !isLoopbackUrl(model.baseUrl)) {
    const detail = 'Skipped: this computer cannot run it as it is.';
    return {
      checks: [
        { id: 'model-available', kind: 'model_available', status: 'skipped', detail },
        { id: 'model-responds', kind: 'model_responds', status: 'skipped', detail },
      ],
      findings: [],
    };
  }
  const student = deps.createStudent(model, manifest.model.inference.contextLength);
  const findings: Finding[] = [];
  let available: InstallCheck;
  try {
    const described = await student.describe();
    const pinned = manifest.model.base.digest;
    if (pinned !== undefined && described.digest !== undefined && described.digest !== pinned) {
      const reason = `${model.runtime} serves a different build of ${manifest.model.base.name} (digest ${described.digest.slice(0, 19)}) than the one tested (${pinned.slice(0, 19)}).`;
      findings.push({ level: manifest.model.adapter ? 'blocked' : 'needs_attention', reason });
      available = {
        id: 'model-available',
        kind: 'model_available',
        status: 'failed',
        detail: reason,
      };
    } else {
      available = {
        id: 'model-available',
        kind: 'model_available',
        status: 'passed',
        detail:
          pinned !== undefined && described.digest === pinned
            ? `${model.model} on ${model.runtime}, the same build that was tested.`
            : `${model.model} on ${model.runtime}.`,
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
    };
  }
  if (!options.loadModel || available.status === 'failed') {
    return {
      checks: [
        available,
        {
          id: 'model-responds',
          kind: 'model_responds',
          status: 'skipped',
          detail: options.loadModel ? 'Skipped: the model is not available.' : 'Not asked for.',
        },
      ],
      findings,
    };
  }
  const started = Date.now();
  let responds: InstallCheck;
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
    responds = {
      id: 'model-responds',
      kind: 'model_responds',
      status: 'passed',
      detail: `Answered in ${(firstReplyMs / 1000).toFixed(1)} s, loading included.`,
      ms: firstReplyMs,
    };
  } catch (error) {
    const reason = `The model didn't answer a short request: ${error instanceof Error ? error.message : String(error)}`;
    findings.push({ level: 'needs_attention', reason });
    responds = { id: 'model-responds', kind: 'model_responds', status: 'failed', detail: reason };
  }
  // The check loads the model once; it is unloaded again whether or not it answered.
  try {
    await student.release();
  } catch (error) {
    findings.push({
      level: 'needs_attention',
      reason: `The model stayed loaded after the check: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return {
    checks: [available, responds],
    findings,
    ...(firstReplyMs === undefined ? {} : { firstReplyMs }),
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
  const model = await modelChecks(deps, manifest, installation, options, blocking);
  const findings = [
    ...fit.findings,
    ...harness.findings,
    ...tools.findings,
    ...resources.findings,
    ...model.findings,
  ];
  const status: InstallStatus = findings.some((finding) => finding.level === 'blocked')
    ? 'blocked'
    : findings.length > 0
      ? 'needs_attention'
      : 'ready';
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
