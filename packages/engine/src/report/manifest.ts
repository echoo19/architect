import {
  GraduateManifestSchema,
  type GraduateManifest,
  type Job,
  type ReportCard,
  type Round,
  type Run,
  type StudentEndpoint,
} from '@architect/shared';
import type { GraduateFreeze } from '../store/records';

export interface ManifestInput {
  freeze: GraduateFreeze;
  job: Job;
  run: Run;
  report: ReportCard;
  /** The run's rounds, to say which one made the frozen version. */
  rounds: readonly Round[];
  /** Where the graduate runs in the workspace: the job's local student. */
  endpoint: StudentEndpoint;
  createdAt: string;
  acceptedAt?: string;
}

/** The round whose kept change made a version, and whether it was a whole draft. */
function origin(rounds: readonly Round[], version: number): { round?: number; draft?: true } {
  const made = rounds.find(
    (round) => round.candidateVersion === version && round.decision === 'kept',
  );
  if (made === undefined) return {};
  return made.draft ? { round: made.index, draft: true } : { round: made.index };
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
    harness: {
      version: freeze.harnessVersion,
      hash: freeze.harnessHash,
      ...origin(input.rounds, freeze.harnessVersion),
    },
    requirements: report.requirements,
    test: { score: report.test.score, perType: report.test.perType, testedOn: report.testedOn },
    mentor: report.mentor,
  });
}
