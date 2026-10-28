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
  /** The final test of a run with no setup on the same job and seed, when one finished. */
  bare: ReportCard | null;
}

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

async function loadEvidence(report: ReportCard, blankStart: boolean): Promise<ReportEvidence> {
  const { runId } = report;
  const [capabilities, references, experiments, progress, bare] = await Promise.all([
    mentoringApi.capabilities(runId),
    mentoringApi.references(runId),
    mentoringApi.experiments(runId),
    mentoringApi.progress(runId),
    // Only a run that started with no setup measures the same student as a run with none.
    blankStart ? bareReport(report) : Promise.resolve(null),
  ]);
  return { capabilities, references, experiments, progress, bare };
}

export function useReportEvidence(report: ReportCard, blankStart: boolean) {
  return useQuery(`report-evidence:${report.runId}:${blankStart ? 'blank' : 'set'}`, () =>
    loadEvidence(report, blankStart),
  );
}
