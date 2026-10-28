import type {
  CapabilityBreakdown,
  Experiment,
  MentoringProgress,
  ReferenceRecord,
  ReportCard,
} from '@architect/shared';
import { api, flowApi } from '../../api/client';
import { mentoringApi } from '../../api/mentoring';
import { useQuery } from '../../api/query';

/** What the report reads beside its card: the run's records, from the engine. */
export interface ReportEvidence {
  capabilities: CapabilityBreakdown;
  references: ReferenceRecord[];
  experiments: Experiment[];
  progress: MentoringProgress;
}

async function loadEvidence(runId: string): Promise<ReportEvidence> {
  const [capabilities, references, experiments, progress] = await Promise.all([
    mentoringApi.capabilities(runId),
    mentoringApi.references(runId),
    mentoringApi.experiments(runId),
    mentoringApi.progress(runId),
  ]);
  return { capabilities, references, experiments, progress };
}

export function useReportEvidence(report: ReportCard) {
  return useQuery(`report-evidence:${report.runId}`, () => loadEvidence(report.runId));
}

/** The final test of a finished run with no setup on the same job and seed, if there is one. */
async function bareReport(report: ReportCard): Promise<ReportCard | null> {
  const runs = await flowApi.runs(report.jobId);
  const current = runs.find((run) => run.id === report.runId);
  const bare = runs.find(
    (run) =>
      run.method === 'bare' &&
      run.status === 'finished' &&
      run.id !== report.runId &&
      run.seed === current?.seed,
  );
  return bare ? api.report(bare.id) : null;
}

/**
 * The untouched student's final test, for a run that started with no setup: only then does a
 * run with none measure the same student. Null otherwise, and while that isn't known yet.
 */
export function useBareReport(report: ReportCard, blankStart: boolean) {
  return useQuery(`bare-report:${report.runId}:${blankStart ? 'blank' : 'set'}`, () =>
    blankStart ? bareReport(report) : Promise.resolve(null),
  );
}
