import { resolve } from 'node:path';
import type {
  Harness,
  Job,
  MentorAdapter,
  StudentAdapter,
  StudentEndpoint,
} from '@architect/shared';
import type { StudentTarget } from '../store/records';
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
  const apiKey =
    endpoint.secretRef === undefined ? undefined : await secret(deps, endpoint.secretRef);
  return deps.adapters.createStudent(endpoint, { apiKey, label: job.student.label });
}

export async function connectMentor(
  deps: Pick<LoopDeps, 'adapters' | 'secrets'>,
  job: Job,
): Promise<MentorAdapter> {
  if (job.mentor.kind !== 'model') {
    throw new Error('Coding-agent mentors are not supported yet; pick a model mentor.');
  }
  return deps.adapters.createMentor(job.mentor, {
    apiKey: await secret(deps, job.mentor.secretRef),
  });
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
