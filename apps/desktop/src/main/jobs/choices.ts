import { isDeepStrictEqual } from 'node:util';
import {
  DEFAULT_STUDENT,
  GLIMMER_BUILDS,
  isLoopbackUrl,
  keyMayGoTo,
  OPENROUTER_BASE_URL,
  STUDENT_PRESETS,
  type AppSettings,
  type ImportedJob,
  type Job,
  type ReplacedModel,
  type StudentEndpoint,
  type StudentPreset,
} from '@architect/shared';
import type { SecretStore } from '../secrets/store';
import type { SettingsStore } from '../settings/store';

/**
 * What the person chose in setup or Settings that a new job starts from: their teacher, their
 * model on this computer, and which hosts they have a key for.
 */
export interface JobChoices {
  mentor: AppSettings['defaultMentor'];
  student: AppSettings['defaultStudent'];
  /** Which keys are saved, by the name they are stored under. */
  keys: Readonly<Record<string, boolean>>;
  /** The addresses of the endpoints the person added, such as a vLLM server on a cluster node. */
  endpoints: readonly string[];
}

/**
 * The choices as they stand now. Keys that can't be read are none: a new job is still made, and
 * the screens that need a key say so where it is read.
 */
export function currentChoices(
  settings: Pick<SettingsStore, 'get'>,
  secrets: Pick<SecretStore, 'status'>,
): JobChoices {
  const { defaultMentor, defaultStudent, customEndpoints } = settings.get();
  let keys: Record<string, boolean> = {};
  try {
    keys = secrets.status();
  } catch (error) {
    console.warn('[jobs] The saved keys could not be read, so no hosted copy is added.', error);
  }
  return {
    mentor: defaultMentor,
    student: defaultStudent,
    keys,
    endpoints: customEndpoints.map((endpoint) => endpoint.baseUrl),
  };
}

/** Whether the model is one of Glimmer's builds, which the hosts below keep a copy of. */
function isGlimmer(model: string): boolean {
  return GLIMMER_BUILDS.some((build) => build.model === model);
}

/**
 * The hosted copy of Glimmer for faster training: OpenRouter, which setup offers, else the first
 * other host whose key is saved. None when no host is connected.
 */
function hostedCopy(keys: JobChoices['keys']): StudentPreset | undefined {
  const connected = STUDENT_PRESETS.filter(
    (preset) =>
      preset.runtime === 'openai_compatible' &&
      preset.secretRef !== undefined &&
      keys[preset.secretRef] === true,
  );
  return connected.find((preset) => preset.baseUrl === OPENROUTER_BASE_URL) ?? connected[0];
}

/**
 * A new job with the person's choices in place of the job's own, so the sample job and a drafted
 * job start from what they set up: the teacher, the model on this computer (build, runtime and
 * address), a hosted copy of Glimmer when a host is connected, and training online when there is
 * one to train on. The job's own context size stays, since the agent is developed under the limit
 * it later runs under. A job file keeps those of its own models that are connected here
 * (`applyFileModels`): where a person's tasks and files are sent is theirs to choose.
 *
 * Only for a job that has just been made. Applying it to an existing job would change a job the
 * person has already looked at, and may have trained.
 */
export function applyChoices(job: Job, choices: JobChoices): Job {
  const { student } = choices;
  const local: StudentEndpoint = {
    runtime: student.runtime,
    baseUrl: student.baseUrl,
    model: student.model,
    contextLength: job.student.local.contextLength,
    ...(student.secretRef === undefined ? {} : { secretRef: student.secretRef }),
  };
  const hosted = glimmerCopy(local, choices.keys);
  return {
    ...job,
    mentor: choices.mentor,
    student: {
      label: isGlimmer(student.model) ? DEFAULT_STUDENT.label : student.model,
      local,
      trainOn: hosted === undefined ? 'local' : 'hosted',
      ...(hosted === undefined ? {} : { hosted }),
    },
  };
}

/** The hosted copy of Glimmer for a model here that is one of its builds, when a host is connected. */
function glimmerCopy(
  local: StudentEndpoint,
  keys: JobChoices['keys'],
): StudentEndpoint | undefined {
  const copy = isGlimmer(local.model) ? hostedCopy(keys) : undefined;
  return copy?.secretRef === undefined
    ? undefined
    : {
        runtime: copy.runtime,
        baseUrl: copy.baseUrl,
        model: copy.model,
        secretRef: copy.secretRef,
        contextLength: local.contextLength,
      };
}

/**
 * Whether a model at this address is connected here: its key is saved and may go to that address,
 * or it needs none and is on this computer or at an endpoint the person added. So a job file can't
 * send a saved key, or the person's tasks, anywhere the person didn't connect.
 */
function connected(
  endpoint: { baseUrl: string; secretRef?: string | undefined },
  choices: JobChoices,
): boolean {
  const { baseUrl, secretRef } = endpoint;
  if (secretRef !== undefined) {
    return choices.keys[secretRef] === true && keyMayGoTo(secretRef, baseUrl);
  }
  return isLoopbackUrl(baseUrl) || choices.endpoints.includes(baseUrl);
}

/**
 * A job file just imported, keeping each of its models that is connected here (decision 094): the
 * teacher, the model on this computer, and the hosted or cluster copy it practices on. The others
 * take the person's choices, as any new job does, and `replaced` names each so the person is told.
 * The model on this computer must answer at an address on this computer, since the agent runs only
 * here (invariant 3); a copy of it goes with it when that is replaced.
 */
export function applyFileModels(job: Job, choices: JobChoices): ImportedJob {
  const defaults = applyChoices(job, choices);
  const replaced: ReplacedModel[] = [];
  const keepMentor = job.mentor.kind === 'model' && connected(job.mentor, choices);
  if (!keepMentor && !isDeepStrictEqual(job.mentor, defaults.mentor)) {
    replaced.push({ role: 'mentor', from: job.mentor.label, to: defaults.mentor.label });
  }
  const { local, hosted } = job.student;
  const keepLocal = isLoopbackUrl(local.baseUrl) && connected(local, choices);
  if (!keepLocal) {
    replaced.push({ role: 'student', from: local.model, to: defaults.student.local.model });
  }
  const student = keepLocal ? withCopy(job, choices) : defaults.student;
  if (hosted !== undefined && !isDeepStrictEqual(student.hosted, hosted)) {
    replaced.push({ role: 'hosted', from: hosted.model, to: student.hosted?.model ?? null });
  }
  return {
    job: { ...job, mentor: keepMentor ? job.mentor : defaults.mentor, student },
    replaced,
  };
}

/**
 * The file's own model on this computer with the copy it practices on: the file's copy when it is
 * connected here, else the hosted copy of Glimmer a new job would get, else none.
 */
function withCopy(job: Job, choices: JobChoices): Job['student'] {
  const { hosted, local } = job.student;
  const keep = hosted !== undefined && connected(hosted, choices);
  const copy = keep ? hosted : glimmerCopy(local, choices.keys);
  const trainOn = copy === undefined ? 'local' : keep ? job.student.trainOn : 'hosted';
  return {
    label: job.student.label,
    local,
    trainOn,
    ...(copy === undefined ? {} : { hosted: copy }),
  };
}
