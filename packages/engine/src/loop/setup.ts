import { join, resolve } from 'node:path';
import {
  GuardError,
  keyDestinationProblem,
  MUSE_VOICE_TRANSCRIBE,
  StudyRecordSchema,
  type ActorAdapter,
  type Harness,
  type Job,
  type MentorAdapter,
  type MentorConfig,
  type StudentAdapter,
  type StudentEndpoint,
  type StudentTarget,
  type Transcriber,
} from '@architect/shared';
import { isStudied, procedureEdit } from '../drafting/study';
import type { HarnessDeps, LoopDeps } from './deps';
import { readJsonFile } from './files';
import { STUDY_FILE } from './paths';

export function studentEndpoint(job: Job, target: StudentTarget): StudentEndpoint {
  if (target === 'local') return job.student.local;
  if (!job.student.hosted) throw new Error(`"${job.name}" has no hosted student endpoint.`);
  return job.student.hosted;
}

async function secret(deps: Pick<LoopDeps, 'secrets'>, ref: string): Promise<string> {
  const value = await deps.secrets.get(ref);
  if (!value) throw new Error(`No key is saved for "${ref}". Add it in Settings and try again.`);
  return value;
}

export async function connectStudent(
  deps: Pick<LoopDeps, 'adapters' | 'secrets'>,
  job: Job,
  target: StudentTarget,
): Promise<StudentAdapter> {
  const endpoint = studentEndpoint(job, target);
  if (endpoint.secretRef !== undefined) guardKeyDestination(endpoint.secretRef, endpoint.baseUrl);
  const apiKey =
    endpoint.secretRef === undefined ? undefined : await secret(deps, endpoint.secretRef);
  return deps.adapters.createStudent(endpoint, { apiKey, label: job.student.label });
}

export async function connectMentor(
  deps: Pick<LoopDeps, 'adapters' | 'secrets'>,
  job: Job,
): Promise<MentorAdapter> {
  return connectTeacher(deps, job.mentor);
}

/** The mentor a config names, reached through the key it asks for and the hosts that key may go to. */
export async function connectTeacher(
  deps: Pick<LoopDeps, 'adapters' | 'secrets'>,
  mentor: MentorConfig,
): Promise<MentorAdapter> {
  if (mentor.kind !== 'model') {
    throw new Error('Coding-agent mentors are not supported yet; pick a model mentor.');
  }
  // A model on this computer, or an endpoint that takes no key, is reached without one.
  if (mentor.secretRef === undefined) return deps.adapters.createMentor(mentor, {});
  guardKeyDestination(mentor.secretRef, mentor.baseUrl);
  return deps.adapters.createMentor(mentor, { apiKey: await secret(deps, mentor.secretRef) });
}

/**
 * The mentor's model as an agent with the student's tools, through the same key and the same
 * host checks as the mentor itself.
 */
export async function connectActor(
  deps: Pick<LoopDeps, 'adapters' | 'secrets'>,
  job: Job,
): Promise<ActorAdapter> {
  const { mentor } = job;
  const create = deps.adapters.createActor;
  if (mentor.kind !== 'model' || create === undefined) {
    throw new Error(`${mentor.label} can't act as the agent in this build.`);
  }
  if (mentor.secretRef === undefined) return create(mentor, {});
  guardKeyDestination(mentor.secretRef, mentor.baseUrl);
  return create(mentor, { apiKey: await secret(deps, mentor.secretRef) });
}

/** Stops a job file from sending a stored key to a host outside the key's own service. */
/** Muse Voice Transcribe, through the Meta key, which goes to Meta's API host only. */
export async function connectTranscriber(
  deps: Pick<LoopDeps, 'adapters' | 'secrets'>,
): Promise<Transcriber> {
  const create = deps.adapters.createTranscriber;
  if (create === undefined) throw new Error("This build can't transcribe recordings.");
  guardKeyDestination(MUSE_VOICE_TRANSCRIBE.secretRef, MUSE_VOICE_TRANSCRIBE.baseUrl);
  return create({ apiKey: await secret(deps, MUSE_VOICE_TRANSCRIBE.secretRef) });
}

function guardKeyDestination(ref: string, baseUrl: string): void {
  const problem = keyDestinationProblem(ref, baseUrl);
  if (problem !== null) throw new GuardError('permission', problem);
}

/** The harness the job says to start from. */
export async function startingHarness(
  job: Job,
  jobDir: string,
  harness: HarnessDeps,
): Promise<Harness> {
  const start = job.startingHarness;
  switch (start.kind) {
    case 'blank':
      return seeded(job, jobDir, harness, harness.blankHarness(job.name, job.description));
    case 'template':
      return seeded(
        job,
        jobDir,
        harness,
        harness.templateHarness(job.name, job.description, start.template),
      );
    case 'import':
      return harness.importHarness(resolve(jobDir, start.path));
  }
}

/**
 * A field job's first harness with the shared procedure its confirmed study wrote (decision 069):
 * which of the organization's own files each skill reads, and in what steps. Any other job, and
 * one whose study isn't confirmed (it can't run), starts from the harness as it was.
 */
async function seeded(
  job: Job,
  jobDir: string,
  harness: HarnessDeps,
  base: Harness,
): Promise<Harness> {
  if (!isStudied(job)) return base;
  let stored: unknown;
  try {
    stored = await readJsonFile(join(jobDir, STUDY_FILE));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base;
    throw error;
  }
  const record = StudyRecordSchema.parse(stored);
  if (record.confirmedAt === undefined) return base;
  return harness.applyEdits(base, [procedureEdit(record.brief)]);
}
