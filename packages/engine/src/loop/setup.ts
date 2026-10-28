import { resolve } from 'node:path';
import {
  GuardError,
  keyDestinationProblem,
  type Harness,
  type Job,
  type MentorAdapter,
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
  const { mentor } = job;
  if (mentor.kind !== 'model') {
    throw new Error('Coding-agent mentors are not supported yet; pick a model mentor.');
  }
  // A model on this computer, or an endpoint that takes no key, is reached without one.
  if (mentor.secretRef === undefined) return deps.adapters.createMentor(mentor, {});
  guardKeyDestination(mentor.secretRef, mentor.baseUrl);
  return deps.adapters.createMentor(mentor, { apiKey: await secret(deps, mentor.secretRef) });
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
