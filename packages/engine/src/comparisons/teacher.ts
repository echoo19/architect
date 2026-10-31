import {
  isLoopbackUrl,
  JobSchema,
  mentorPricing,
  type Job,
  type MentorConfig,
  type RunsOn,
  type StudentEndpoint,
} from '@architect/shared';

/*
 * The teacher alone (decision 095): the field's teacher model, or another chosen one, takes the
 * job itself as the agent under test, in a run of its own with no teaching. It reaches the model
 * as a student endpoint, never as a mentor, so nothing it does can reach any mentor's context.
 */

/** A model teacher, as a job's mentor settings name one. */
export type ModelTeacher = Extract<MentorConfig, { kind: 'model' }>;

/** The model the teacher arm runs, or why it can't run one: a sentence for its reason. */
export function teacherOf(job: Job, chosen: ModelTeacher | undefined): ModelTeacher | string {
  const teacher = chosen ?? job.mentor;
  if (teacher.kind !== 'model') {
    return `${teacher.label} is a coding agent, so it can't take the test as the agent.`;
  }
  if (teacher.provider === 'anthropic') {
    return `${teacher.label} doesn't speak the OpenAI-compatible protocol the agent's runtime uses, so it can't take the test as the agent.`;
  }
  if (mentorPricing(teacher) === undefined) {
    return `${teacher.label}'s price isn't known, so its attempts couldn't be held to a cap.`;
  }
  return teacher;
}

/** Where a model at this address answers. */
export function runsOnOf(baseUrl: string): RunsOn {
  return isLoopbackUrl(baseUrl) ? 'this_computer' : 'hosted';
}

/** The teacher as the job's agent: an OpenAI-compatible endpoint at its own price. */
function endpointOf(teacher: ModelTeacher, contextLength: number): StudentEndpoint {
  const pricing = mentorPricing(teacher);
  return {
    runtime: 'openai_compatible',
    baseUrl: teacher.baseUrl,
    model: teacher.model,
    ...(teacher.secretRef === undefined ? {} : { secretRef: teacher.secretRef }),
    contextLength,
    ...(pricing === undefined ? {} : { pricing }),
  };
}

/**
 * The teacher arm's job copy: the arm's copy with the teacher as the agent under test, on the
 * hosted slot every arm takes its locked test on, named after the teacher. It keeps the source's
 * local student, which every arm pins when it freezes; the teacher arm never answers on it.
 */
export function teacherJob(copy: Job, teacher: ModelTeacher): Job {
  return JobSchema.parse({
    ...copy,
    student: {
      ...copy.student,
      label: teacher.label,
      trainOn: 'hosted',
      hosted: endpointOf(teacher, copy.student.local.contextLength),
    },
  });
}
