import {
  ComparisonReportSchema,
  RuntimeMeasurementSchema,
  type CapabilityBreakdown,
  type ComparisonReport,
  type Experiment,
  type MentoringProgress,
  type ReferenceRecord,
  type ReportCard,
  type RuntimeMeasurement,
} from '@architect/shared';
import { z } from 'zod';
import { api, architect, flowApi, read } from '../../api/client';
import { mentoringApi } from '../../api/mentoring';
import { useQuery } from '../../api/query';

/** What the report reads beside its card: the run's records, from the engine. */
export interface ReportEvidence {
  capabilities: CapabilityBreakdown;
  references: ReferenceRecord[];
  experiments: Experiment[];
  progress: MentoringProgress;
  /** What a runtime meter read while the run's final tests ran here; none where none ran. */
  measurements: RuntimeMeasurement[];
}

async function loadEvidence(runId: string): Promise<ReportEvidence> {
  const [capabilities, references, experiments, progress, measurements] = await Promise.all([
    mentoringApi.capabilities(runId),
    mentoringApi.references(runId),
    mentoringApi.experiments(runId),
    mentoringApi.progress(runId),
    read(
      'runs.runtimeMeasurements',
      z.array(RuntimeMeasurementSchema),
      architect().runs.runtimeMeasurements(runId),
    ),
  ]);
  return { capabilities, references, experiments, progress, measurements };
}

export function useReportEvidence(report: ReportCard) {
  return useQuery(`report-evidence:${report.runId}`, () => loadEvidence(report.runId));
}

/**
 * The comparisons runner's report this run is an arm of, when the app runs on that comparison's
 * data folder (decision 045); null otherwise. Read apart, so a report that can't be read leaves
 * the rest of the card standing.
 */
export function useComparisonReport(report: ReportCard) {
  return useQuery(`comparison-report:${report.runId}`, (): Promise<ComparisonReport | null> =>
    read(
      'reports.comparisons',
      ComparisonReportSchema.nullable(),
      architect().reports.comparisons(report.runId),
    ),
  );
}

/** What the meter read over the final test this card reports: the most memory, and a cold start. */
export interface RuntimeFigures {
  peakProcessBytes: number | null;
  peakGpuBytes: number | null;
  coldStartMs: number | null;
}

/**
 * The meter's figures for the card's own final test, on the endpoint it ran on. A test resumed
 * after a pause has a record per stretch, and its peak is the most any of them saw; its cold
 * start is the first one measured. Null when no meter read that test.
 */
export function runtimeFigures(
  measurements: readonly RuntimeMeasurement[],
  report: ReportCard,
): RuntimeFigures | null {
  const tested = measurements.filter(
    (item) => item.split === 'test' && item.target === report.testedOn,
  );
  if (tested.length === 0) return null;
  const most = (values: (number | null)[]) => {
    const read = values.filter((value): value is number => value !== null);
    return read.length > 0 ? Math.max(...read) : null;
  };
  const figures = {
    peakProcessBytes: most(tested.map((item) => item.peakProcessBytes)),
    peakGpuBytes: most(tested.map((item) => item.peakGpuBytes)),
    coldStartMs: tested.find((item) => item.coldStartMs !== null)?.coldStartMs ?? null,
  };
  return Object.values(figures).some((value) => value !== null) ? figures : null;
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
