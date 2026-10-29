import {
  DEFAULT_STUDENT,
  GLIMMER_BUILDS,
  OPENROUTER_BASE_URL,
  STUDENT_PRESETS,
  type AppSettings,
  type Job,
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
}

/**
 * The choices as they stand now. Keys that can't be read are none: a new job is still made, and
 * the screens that need a key say so where it is read.
 */
export function currentChoices(
  settings: Pick<SettingsStore, 'get'>,
  secrets: Pick<SecretStore, 'status'>,
): JobChoices {
  const { defaultMentor, defaultStudent } = settings.get();
  let keys: Record<string, boolean> = {};
  try {
    keys = secrets.status();
  } catch (error) {
    console.warn('[jobs] The saved keys could not be read, so no hosted copy is added.', error);
  }
  return { mentor: defaultMentor, student: defaultStudent, keys };
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
 * A new job with the person's choices in place of the job's own, so the sample job, a job file
 * from somewhere else and a drafted job all start from what they set up: the teacher, the model
 * on this computer (build, runtime and address), a hosted copy of Glimmer when a host is
 * connected, and training online when there is one to train on. The job's own context size stays,
 * since the agent is developed under the limit it later runs under. A job file's own hosted copy
 * goes: where a person's tasks and files are sent is theirs to choose.
 *
 * Only for a job that has just been made. Applying it to an existing job would change a job the
 * person has already looked at, and may have trained.
 */
export function applyChoices(job: Job, choices: JobChoices): Job {
  const { student } = choices;
  const contextLength = job.student.local.contextLength;
  const local: StudentEndpoint = {
    runtime: student.runtime,
    baseUrl: student.baseUrl,
    model: student.model,
    contextLength,
    ...(student.secretRef === undefined ? {} : { secretRef: student.secretRef }),
  };
  const glimmer = isGlimmer(student.model);
  const copy = glimmer ? hostedCopy(choices.keys) : undefined;
  const hosted: StudentEndpoint | undefined =
    copy?.secretRef === undefined
      ? undefined
      : {
          runtime: copy.runtime,
          baseUrl: copy.baseUrl,
          model: copy.model,
          secretRef: copy.secretRef,
          contextLength,
        };
  return {
    ...job,
    mentor: choices.mentor,
    student: {
      label: glimmer ? DEFAULT_STUDENT.label : student.model,
      local,
      trainOn: hosted === undefined ? 'local' : 'hosted',
      ...(hosted === undefined ? {} : { hosted }),
    },
  };
}
