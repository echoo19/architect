import type {
  FolderProblem,
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
  harness_valid: 'Setup',
  tools_load: 'Tools',
  resources_bound: 'Folders',
  adapter_runtime: 'llama.cpp',
  model_available: 'Base model',
  model_responds: 'Model responds',
};

export const STATUS_LABELS: Record<InstallStatus, string> = {
  ready: 'All checks passed',
  needs_attention: 'Needs attention',
  blocked: "Can't run",
  unchecked: 'Not checked yet',
};

export function statusMark(status: InstallStatus): MarkState {
  if (status === 'ready') return 'ok';
  if (status === 'blocked') return 'blocked';
  return 'attention';
}

/** Checks whose failure the user can always fix here, so it never reads as blocking. */
const FIXABLE_HERE: ReadonlySet<string> = new Set([
  'resources_bound',
  'adapter_runtime',
  'model_responds',
]);

/** A check's outcome as a row mark: a failed check blocks or needs attention, as its status says. */
export function checkMark(check: InstallCheck, status: InstallStatus): MarkState {
  if (check.status === 'passed') return 'ok';
  if (check.status === 'skipped') return 'off';
  return status === 'blocked' && !FIXABLE_HERE.has(check.kind) ? 'blocked' : 'attention';
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

/** What a check's words depend on: the model binding, this computer, and the checks beside it. */
export type CheckContext = Pick<Installation, 'model' | 'checks'> & {
  machine?: Installation['machine'];
};

/** True when llama.cpp serves the version, with trained weights on its base (decision 041). */
export function servedWithWeights(context: Pick<CheckContext, 'checks'>): boolean {
  return context.checks.some((check) => check.kind === 'adapter_runtime');
}

/** Where the base model of a version with trained weights comes from, and why that build. */
export const WEIGHTS_BASE = 'downloaded through Ollama, the exact build its trained weights need';

/** The engine's own sentence, said like the rows around it: without a closing full stop. */
function asRow(detail: string): string {
  return detail.replace(/\.$/, '');
}

/**
 * What a check found, said the way the rest of the app says it, from the fields the engine gives
 * each check: a passed fit check names this computer (what runs the model has rows of its own, so
 * a row never vouches for another), llama.cpp's its build, a passed model check the model and
 * whether it is the build that was tested, and a skipped one why it wasn't tried. A failed check
 * keeps its own words, which say what to do, and so does a check stored before those fields.
 */
export function checkDetail(check: InstallCheck, context: CheckContext): string {
  if (check.status === 'skipped') {
    if (check.skipped === 'after_failure') return 'Not tried, since a check above failed';
    if (check.skipped === 'not_asked') return 'Not tried yet';
    return asRow(check.detail);
  }
  if (check.status !== 'passed') return check.detail;
  const { model, machine } = context;
  switch (check.kind) {
    case 'compatibility':
      return machine
        ? `${osName(machine.os)} ${machine.arch} · ${formatBytes(machine.memoryBytes)}`
        : asRow(check.detail);
    case 'harness_valid':
      return 'The same setup that was tested';
    case 'resources_bound':
      return 'Every folder is chosen and has its files';
    case 'adapter_runtime':
      return check.build === undefined ? asRow(check.detail) : `Build ${check.build}`;
    case 'model_available': {
      if (servedWithWeights(context)) return `${model.model}, ${WEIGHTS_BASE}`;
      const same = check.sameBuild === true ? ', the build that was tested' : '';
      return `${model.model} on ${runtimeName(model.runtime)}${same}`;
    }
    default:
      return asRow(check.detail);
  }
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
  | { kind: 'llama' }
  | { kind: 'download'; model: string }
  | { kind: 'model' }
  | { kind: 'check' };

/** The failed check of a kind, if there is one. */
function failedCheck(installation: Installation, kind: string): InstallCheck | undefined {
  return installation.checks.find((check) => check.kind === kind && check.status === 'failed');
}

/**
 * Whether the way out is another model for this agent: the base here is another build than the
 * one it was tested or trained on, or a version with trained weights is set to a runtime other
 * than Ollama.
 */
export function needsAnotherModel(installation: Installation): boolean {
  return installation.checks.some(
    (check) =>
      check.status === 'failed' &&
      (check.modelProblem === 'other_build' || check.modelProblem === 'wrong_runtime'),
  );
}

/**
 * The fix for one folder: choose one, allow the one chosen, or choose another when the one chosen
 * is gone or lacks files. From the folders check's own list; a check stored before it had one is
 * read from the bindings and grants.
 */
function folderFix(
  installation: Installation,
  resource: PackageManifest['resources'][number],
  folders: readonly FolderProblem[] | undefined,
): Fix | null {
  const { name } = resource;
  if (folders !== undefined) {
    const problems = new Set(
      folders.filter((entry) => entry.name === name).map((entry) => entry.problem),
    );
    if (problems.has('not_chosen')) return { kind: 'choose', resource: name, again: false };
    if (problems.has('not_allowed'))
      return { kind: 'allow', resource: name, grant: resource.access };
    if (problems.has('missing') || problems.has('files')) {
      return { kind: 'choose', resource: name, again: true };
    }
    return null;
  }
  const bound = installation.bindings[name] !== undefined;
  const grant = installation.grants.resources[name] ?? 'none';
  if (!bound && resource.required) return { kind: 'choose', resource: name, again: false };
  if (bound && resource.required && grant === 'none') {
    return { kind: 'allow', resource: name, grant: resource.access };
  }
  return null;
}

/**
 * The ways out of what the checks found, each tied to a check: a folder to choose (again), a
 * folder to allow, llama.cpp to set up in Settings, a model to download, another model to choose
 * for the agent, or checking again once something outside Architect is fixed. A blocked
 * installation has no fix on this computer unless the fix is another model.
 */
export function fixesFor(installation: Installation, manifest: PackageManifest): Fix[] {
  if (installation.status === 'ready') return [];
  const anotherModel = needsAnotherModel(installation);
  if (installation.status === 'blocked') return anotherModel ? [{ kind: 'model' }] : [];
  const fixes: Fix[] = [];
  const folders = failedCheck(installation, 'resources_bound');
  if (folders) {
    for (const resource of manifest.resources) {
      const fix = folderFix(installation, resource, folders.folders);
      if (fix) fixes.push(fix);
    }
  }
  if (failedCheck(installation, 'adapter_runtime')) fixes.push({ kind: 'llama' });
  if (anotherModel) {
    fixes.push({ kind: 'model' });
  } else if (
    failedCheck(installation, 'model_available') &&
    installation.model.runtime === 'ollama'
  ) {
    fixes.push({ kind: 'download', model: installation.model.model });
  }
  fixes.push({ kind: 'check' });
  return fixes;
}

/** How this computer's own checks are titled in the agent's settings and on its results. */
export const WORKS_HERE_TITLE = 'Works on this computer';

/** What stands in the way of an agent here, said plainly, with the engine's sentences kept apart. */
export interface InstallProblem {
  /** One plain sentence: what is missing or wrong, with no hashes, builds or file names. */
  cause: string;
  /** The engine's own sentences for the checks that failed, for whoever opens Details. */
  details: string[];
}

export interface InstallProblemContext {
  /** The model the agent was made with, as people call it: "Glimmer". */
  model: string;
  /** What that model weighs on disk, when the package says. */
  baseBytes?: number | undefined;
}

/**
 * Why an agent isn't ready on this computer, in one plain sentence, from the fields of the check
 * that failed and never from its words: a model of another build, one not downloaded yet, a
 * runtime that doesn't answer, llama.cpp missing, a folder not chosen, a tool or the setup that
 * won't load. Null when no check failed.
 */
export function installProblem(
  installation: Pick<Installation, 'checks'>,
  { model, baseBytes }: InstallProblemContext,
): InstallProblem | null {
  const failed = installation.checks.filter((check) => check.status === 'failed');
  const first = failed[0];
  if (!first) return null;
  const size = baseBytes === undefined ? '' : ` (${formatBytes(baseBytes)})`;
  const say = (cause: string): InstallProblem => ({
    cause,
    details: failed.map((check) => check.detail),
  });
  switch (first.kind) {
    case 'compatibility':
      return say("This computer can't run it.");
    case 'harness_valid':
      return say("Its setup doesn't load.");
    case 'tools_load':
      return say("One of its tools doesn't load.");
    case 'resources_bound':
      return say(
        first.folders && first.folders.length > 1
          ? "Some of the folders it needs aren't ready."
          : "A folder it needs isn't ready.",
      );
    case 'adapter_runtime':
      return say('Needs llama.cpp to run its trained weights.');
    case 'model_available':
      switch (first.modelProblem) {
        case 'other_build':
          return say(`Needs a different copy of ${model}${size}.`);
        case 'not_downloaded':
          return say(`${model} isn't downloaded yet${size}.`);
        case 'wrong_runtime':
          return say(`Its trained weights need Ollama's copy of ${model}.`);
        default:
          return say(`${model} isn't answering.`);
      }
    case 'model_responds':
      return say(`${model} didn't answer a test question.`);
    default:
      return say("Something it needs isn't ready.");
  }
}
