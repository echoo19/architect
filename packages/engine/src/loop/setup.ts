import { resolve } from 'node:path';
import {
  GuardError,
  keyDestinationProblem,
  type ActorAdapter,
  type Harness,
  type Job,
  type MentorAdapter,
  type MentorConfig,
  type StudentAdapter,
  type StudentEndpoint,
  type StudentTarget,
} from '@architect/shared';
import type { HarnessDeps, LoopDeps } from './deps';

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
      return harness.blankHarness(job.name, job.description);
    case 'template':
      return harness.templateHarness(job.name, job.description, start.template);
    case 'import':
      return harness.importHarness(resolve(jobDir, start.path));
  }
}
