import type {
  InstallCheck,
  InstallStatus,
  Installation,
  PackageManifest,
  ResourceGrant,
} from '@architect/shared';
import type { MarkState } from '@architect/ui';
import { formatBytes } from '../lib/format';

/** How this computer's own checks are titled wherever they appear: never as the author's result. */
export const INSTALL_CHECKS_TITLE = 'Install checks on this computer';

/** How the author's locked-test result is titled wherever it appears. */
export const AUTHOR_RESULT_TITLE = "Evaluated on the author's computer";

/** What each install check looks at, named for people. */
export const CHECK_LABELS: Record<string, string> = {
  compatibility: 'This computer',
  harness_valid: 'Harness',
  tools_load: 'Tools',
  resources_bound: 'Folders',
  model_available: 'Base model',
  model_responds: 'Model answers',
};

export const STATUS_LABELS: Record<InstallStatus, string> = {
  ready: 'Ready',
  needs_attention: 'Needs attention',
  blocked: 'Blocked',
  unchecked: 'Not checked yet',
};

export function statusMark(status: InstallStatus): MarkState {
  if (status === 'ready') return 'ok';
  if (status === 'blocked') return 'blocked';
  return 'attention';
}

/** A check's outcome as a row mark: a failed check blocks or needs attention, as its status says. */
export function checkMark(check: InstallCheck, status: InstallStatus): MarkState {
  if (check.status === 'passed') return 'ok';
  if (check.status === 'skipped') return 'off';
  return status === 'blocked' && check.kind !== 'resources_bound' && check.kind !== 'model_responds'
    ? 'blocked'
    : 'attention';
}

/** "Windows", "macOS", or the platform's own name. */
export function osName(os: string): string {
  if (os === 'win32') return 'Windows';
  if (os === 'darwin') return 'macOS';
  if (os === 'linux') return 'Linux';
  return os;
}

/** "Ollama", "LM Studio or another OpenAI-compatible server", "llama.cpp". */
export function runtimeName(runtime: string): string {
  if (runtime === 'ollama') return 'Ollama';
  if (runtime === 'openai_compatible') return 'an OpenAI-compatible server';
  return runtime;
}

/**
 * What a check found, said the way the rest of the app says it: a passed fit check names this
 * computer and its runtime, a passed model check the model and where it runs. Anything else is
 * the check's own words, which say what to do.
 */
export function checkDetail(check: InstallCheck, installation: Installation): string {
  if (check.status !== 'passed') return check.detail;
  const { model, machine } = installation;
  if (check.kind === 'compatibility' && machine) {
    return `${osName(machine.os)} ${machine.arch} · ${formatBytes(machine.memoryBytes)} · ${runtimeName(model.runtime)} at ${new URL(model.baseUrl).host}`;
  }
  if (check.kind === 'model_available') {
    const same = check.detail.includes('same build') ? ', the build that was tested' : '';
    return `${model.model} on ${runtimeName(model.runtime)}${same}`;
  }
  return check.detail;
}

/** What granting access lets the agent do with a folder, in a few words. */
export const GRANT_LABELS: Record<ResourceGrant, string> = {
  none: 'Not allowed',
  read: 'Read',
  read_write: 'Read and change',
};

/** Something the user can do about a check that didn't pass. */
export type Fix =
  | { kind: 'choose'; resource: string; again: boolean }
  | { kind: 'allow'; resource: string; grant: ResourceGrant }
  | { kind: 'download'; model: string }
  | { kind: 'check' };

/**
 * The ways out of what the checks found, each tied to a check: a folder to choose (again), a
 * folder to allow, a model to download, or checking again once something outside Architect is
 * fixed. A blocked installation has no fix on this computer, so it gets none.
 */
export function fixesFor(installation: Installation, manifest: PackageManifest): Fix[] {
  if (installation.status === 'ready' || installation.status === 'blocked') return [];
  const failed = (kind: string) =>
    installation.checks.some((check) => check.kind === kind && check.status === 'failed');
  const fixes: Fix[] = [];
  if (failed('resources_bound')) {
    const detail = installation.checks.find((check) => check.kind === 'resources_bound')?.detail;
    for (const resource of manifest.resources) {
      const bound = installation.bindings[resource.name] !== undefined;
      const grant = installation.grants.resources[resource.name] ?? 'none';
      if (!bound && resource.required) {
        fixes.push({ kind: 'choose', resource: resource.name, again: false });
      } else if (bound && resource.required && grant === 'none') {
        fixes.push({ kind: 'allow', resource: resource.name, grant: resource.access });
      } else if (bound && detail?.includes(`${resource.name}/`)) {
        fixes.push({ kind: 'choose', resource: resource.name, again: true });
      }
    }
  }
  if (failed('model_available') && installation.model.runtime === 'ollama') {
    fixes.push({ kind: 'download', model: installation.model.model });
  }
  fixes.push({ kind: 'check' });
  return fixes;
}
