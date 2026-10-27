import {
  GraduateManifestSchema,
  type GraduateManifest,
  type Job,
  type ReportCard,
  type Run,
  type StudentEndpoint,
} from '@architect/shared';
import type { GraduateFreeze } from '../store/records';

export interface ManifestInput {
  freeze: GraduateFreeze;
  job: Job;
  run: Run;
  report: ReportCard;
  /** Where the graduate runs in the workspace: the job's local student. */
  endpoint: StudentEndpoint;
  createdAt: string;
  acceptedAt?: string;
}

/** graduate.yaml: the frozen harness and pinned student, with what its locked test showed. */
export function buildGraduateManifest(input: ManifestInput): GraduateManifest {
  const { freeze, job, run, report, endpoint } = input;
  return GraduateManifestSchema.parse({
    format: 1,
    id: freeze.graduateId,
    name: job.name,
    jobId: job.id,
    runId: run.id,
    method: run.method,
    createdAt: input.createdAt,
    acceptedAt: input.acceptedAt,
    student: {
      label: job.student.label,
      runtime: endpoint.runtime,
      baseUrl: endpoint.baseUrl,
      model: freeze.student.model,
      quantization: freeze.student.quantization,
      digest: freeze.student.digest,
      sizeBytes: freeze.student.sizeBytes,
      contextLength: endpoint.contextLength,
    },
    harness: { version: freeze.harnessVersion, hash: freeze.harnessHash },
    requirements: report.requirements,
    test: { score: report.test.score, perType: report.test.perType },
    mentor: report.mentor,
  });
}
