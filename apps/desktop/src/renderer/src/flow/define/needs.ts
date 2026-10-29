import {
  GLIMMER_BUILDS,
  PROVIDER_IDS,
  PROVIDERS,
  type Job,
  type LocalRuntimes,
  type ProviderId,
  type StudentEndpoint,
  type StudentTarget,
} from '@architect/shared';
import { formatBytes } from '../../lib/format';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { mentorProvider } from '../../onboarding/mentor';
import { isInstalled } from '../../settings/models/StudentRows';
import { modelNames } from '../names';
import type { ModelNames } from '../train/phase';
import { aKey, hostedAvailability, providerName, type KeyStatus } from './hosted';
import { BLOCK_REASONS, blockFix, idleBlock, keyHint } from './teacher-menu';

/** The one thing that puts a missing piece right. */
export type NeedAction =
  /** Saves a provider's key. */
  | { kind: 'add_key'; provider: ProviderId }
  /** Opens the settings where the teacher or the online copy is chosen and its key is saved. */
  | { kind: 'open'; tab: 'mentor' | 'student' }
  | { kind: 'download'; model: string }
  /** Looks again: for the saved keys, for the model on this computer, or for the online copy. */
  | { kind: 'recheck'; what: 'keys' | 'local' | 'host' };

/** Something a run can't start without, and the action that fixes it. */
export interface Need {
  id: string;
  title: string;
  detail: string;
  /** What the button says. */
  label: string;
  action: NeedAction;
}

/** What the app knows about the models on this computer, as far as it knows yet. */
export type LocalState = LocalRuntimes | 'loading' | 'error';

/** The online copy didn't answer when it was asked. */
export interface HostedProblem {
  error: string;
  hint?: string | undefined;
}

export interface RunNeedsInput {
  job: Job;
  /** Where the final test will run. */
  testPlace: StudentTarget;
  keys: KeyStatus;
  local: LocalState;
  /** What the last live check of the online copy found, when it found it out of reach. */
  hostedProblem: HostedProblem | null;
  /** Whether a Hugging Face token comes from anywhere, which weights are trained with. */
  token: 'found' | 'none' | 'unknown';
}

/** The provider an endpoint's key belongs to, by its address; `other` for one the user added. */
function providerOf(endpoint: StudentEndpoint): ProviderId {
  return PROVIDER_IDS.find((id) => PROVIDERS[id].baseUrl === endpoint.baseUrl) ?? 'other';
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether the run uses a key that is saved by name, which a failure to read the keys leaves unknown. */
function usesKey(job: Job, usesHosted: boolean): boolean {
  const teacher = job.mentor.kind === 'model' && job.mentor.secretRef !== undefined;
  return teacher || (usesHosted && job.student.hosted?.secretRef !== undefined);
}

function teacherNeed(job: Job, teacher: string, keys: Record<string, boolean>): Need | null {
  const { mentor } = job;
  if (mentor.kind !== 'model' || mentor.secretRef === undefined) return null;
  if (keys[mentor.secretRef] === true) return null;
  const provider = mentorProvider(mentor);
  const missing = {
    id: 'teacher-key',
    title: `${teacher} needs a ${provider} key`,
    detail: `It teaches your agent, and ${provider} bills your account for it.`,
  };
  // A key for an endpoint the user added is saved in the teacher's settings, with its address.
  if (mentor.provider === 'other') {
    return { ...missing, label: 'Add its key', action: { kind: 'open', tab: 'mentor' } };
  }
  return {
    ...missing,
    label: `Add ${aKey(provider)}`,
    action: { kind: 'add_key', provider: mentor.provider },
  };
}

/**
 * The model on this computer. Practice and the final test use it unless they run online, and the
 * finished agent runs on it whatever trained it, so a run that ends without it can't pin the
 * agent's model.
 */
function modelNeed(
  job: Job,
  student: string,
  testPlace: StudentTarget,
  local: LocalState,
): Need | null {
  const endpoint = job.student.local;
  const device = deviceInSentence(currentPlatform());
  if (local === 'loading') return null;
  if (local === 'error') {
    return {
      id: 'local-unknown',
      title: `Couldn't check whether ${student} is on ${device}`,
      detail: 'Architect looks before a run starts, so it never stops halfway for want of a model.',
      label: 'Check again',
      action: { kind: 'recheck', what: 'local' },
    };
  }
  // Only a runtime at the address Architect looked at can be told about; the run finds out the rest.
  if (endpoint.runtime !== 'ollama' || endpoint.baseUrl !== local.ollama.baseUrl) return null;
  if (!local.ollama.running) {
    return {
      id: 'ollama-off',
      title: "Ollama isn't running",
      detail: `${student} runs through Ollama on ${device}. Open Ollama, then check again.`,
      label: 'Check again',
      action: { kind: 'recheck', what: 'local' },
    };
  }
  if (isInstalled(local.ollama, endpoint.model)) return null;
  const runs = [
    job.student.trainOn === 'local' ? 'practice' : null,
    testPlace === 'local' ? 'the final test' : null,
  ].filter((part): part is string => part !== null);
  const bytes = GLIMMER_BUILDS.find((build) => build.model === endpoint.model)?.downloadBytes;
  // Neither is here when both run online; the agent that training ends with still is.
  const detail =
    runs.length === 0
      ? 'The finished agent runs on it, so it has to be here when training ends. It downloads once.'
      : `${capitalized(runs.join(' and '))} run${runs.length === 1 ? 's' : ''} on it. It downloads once.`;
  return {
    id: 'model-missing',
    title: `${student} isn't on ${device} yet`,
    detail,
    label: bytes === undefined ? 'Download' : `Download · ${formatBytes(bytes)}`,
    action: { kind: 'download', model: endpoint.model },
  };
}

/** The online copy, which practice and the final test use when they run online. */
function hostNeed(
  job: Job,
  student: string,
  keys: KeyStatus,
  problem: HostedProblem | null,
): Need | null {
  const { hosted } = job.student;
  const availability = hostedAvailability(job.student, keys);
  if (!availability.available) {
    if (availability.why === 'no_host' || hosted === undefined) {
      return {
        id: 'host-missing',
        title: 'The online copy needs a service',
        detail: `Pick the online service that runs ${student}.`,
        label: 'Pick a service',
        action: { kind: 'open', tab: 'student' },
      };
    }
    // Keys still being looked for, or that can't be read, are for the keys' own report.
    if (availability.why !== 'no_key') return null;
    const provider = providerName(hosted);
    const named = providerOf(hosted);
    const missing = {
      id: 'host-key',
      title: `${provider} needs a key`,
      detail: `It runs ${student} online and bills your account.`,
    };
    // An endpoint the user added has its key saved with its address, in the agent's model.
    if (named === 'other') {
      return { ...missing, label: 'Add its key', action: { kind: 'open', tab: 'student' } };
    }
    return {
      ...missing,
      label: `Add ${aKey(provider)}`,
      action: { kind: 'add_key', provider: named },
    };
  }
  if (problem === null || hosted === undefined) return null;
  return {
    id: 'host-unreachable',
    title: `${providerName(hosted)} didn't answer`,
    detail: [problem.error, problem.hint].filter(Boolean).join(' '),
    label: 'Try again',
    action: { kind: 'recheck', what: 'host' },
  };
}

/**
 * The teacher can change nothing in this run: the person left only its weights on, and the app
 * already knows they can't be trained here. The run would only stop at its start with this reason,
 * so it is said before. The title is about what the teacher is able to do and not what it may: the
 * switch for retraining is on, and what it lacks is a key, a budget or an offline final test, so
 * a title that says nothing is permitted would contradict the tab that shows the switch on.
 */
function idleNeed(
  job: Job,
  names: ModelNames,
  testPlace: StudentTarget,
  token: RunNeedsInput['token'],
): Need | null {
  const block = idleBlock(job, { token, testPlace });
  if (block === null) return null;
  const device = deviceInSentence(currentPlatform());
  return {
    id: 'teacher-idle',
    title: `${names.mentor} can't change anything yet`,
    detail: `Only retraining ${names.student} itself is on, and it ${BLOCK_REASONS[block]}.${keyHint(block)} ${blockFix(block, device)}`,
    label: `Open ${names.mentor}'s settings`,
    action: { kind: 'open', tab: 'mentor' },
  };
}

/**
 * What a run can't start without, before it starts: the teacher's key, the model on this
 * computer, and the online copy and its key for whatever runs online. The model is needed even
 * when practice and the final test both run online, because the finished agent runs on this
 * computer and training ends by recording which build of the model that is. Each says what is
 * missing and carries the one action that fixes it. A run with everything in place needs nothing,
 * and the list is empty.
 */
export function runNeeds({
  job,
  testPlace,
  keys,
  local,
  hostedProblem,
  token,
}: RunNeedsInput): Need[] {
  const names = modelNames(job);
  const usesHosted = job.student.trainOn === 'hosted' || testPlace === 'hosted';
  const needs: Need[] = [];

  if (keys === 'error') {
    if (usesKey(job, usesHosted)) {
      needs.push({
        id: 'keys-unreadable',
        title: "Couldn't check for saved keys",
        detail: 'Architect looks for your keys before a run starts.',
        label: 'Check again',
        action: { kind: 'recheck', what: 'keys' },
      });
    }
  } else if (keys !== 'loading') {
    const teacher = teacherNeed(job, names.mentor, keys);
    if (teacher) needs.push(teacher);
  }
  const idle = idleNeed(job, names, testPlace, token);
  if (idle) needs.push(idle);
  const model = modelNeed(job, names.student, testPlace, local);
  if (model) needs.push(model);
  if (usesHosted) {
    const host = hostNeed(job, names.student, keys, hostedProblem);
    if (host) needs.push(host);
  }
  return needs;
}

/** One line for the footer while something is missing: the first need, and how many more wait. */
export function needsSummary(needs: readonly Need[]): string {
  const [first, ...rest] = needs;
  if (first === undefined) return '';
  return rest.length === 0 ? first.title : `${first.title}, and ${rest.length} more`;
}
