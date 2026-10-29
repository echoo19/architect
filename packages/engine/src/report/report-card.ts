import type {
  Guardrails,
  Job,
  LineageEntry,
  ReportCard,
  Round,
  Run,
  StudentTarget,
  TypeResult,
} from '@architect/shared';

export interface TestResult {
  taskType: string;
  pass: boolean;
  latencyMs: number;
  /** The graduate refused the task because a guardrail matched it. */
  refused: boolean;
}

export interface ReportCardInput {
  job: Job;
  run: Run;
  rounds: Round[];
  lineage: LineageEntry[];
  /** Locked-test results of the frozen graduate, all from one student endpoint. */
  test: TestResult[];
  /** The frozen graduate's guardrails. */
  guardrails: Guardrails;
  student: ReportCard['student'];
  testedOn: StudentTarget;
  mentor: ReportCard['mentor'];
  /** The author claimed "ready" in some round of training. */
  readyClaimed: boolean;
  /** What the hosted student cost the run so far; zero when it ran locally. */
  studentUsd: number;
  ranOffline: boolean;
  createdAt: string;
  /** Where the final test's tasks came from, for a job whose tasks weren't shipped with it. */
  tasks?: ReportCard['tasks'];
}

/** Nearest-rank percentile, 0 when there are no values. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? 0;
}

function refusedTypes(guardrails: Guardrails, job: Job): ReportCard['refusedTypes'] {
  const seen = new Set<string>();
  const refused: ReportCard['refusedTypes'] = [];
  for (const rule of guardrails.refuse) {
    if (seen.has(rule.taskType)) continue;
    seen.add(rule.taskType);
    const label = job.taskTypes.find((type) => type.id === rule.taskType)?.label ?? rule.taskType;
    refused.push({ type: rule.taskType, label, reason: rule.reason });
  }
  return refused;
}

function devCurve(run: Run, rounds: Round[]): ReportCard['dev']['curve'] {
  const curve: ReportCard['dev']['curve'] = [];
  if (run.devBaseline) curve.push({ round: 0, score: run.devBaseline, decision: 'baseline' });
  for (const round of rounds) {
    if (round.status === 'decided' && round.devAfter && round.decision) {
      curve.push({ round: round.index, score: round.devAfter, decision: round.decision });
    }
  }
  return curve;
}

/** How many dev runs a change's measured scores add up. */
function devRuns(entry: LineageEntry, devTasks: number): number {
  return devTasks > 0 ? Math.max(1, Math.round(entry.measured.devAfter.total / devTasks)) : 1;
}

/** The three kept changes that helped dev most, compared per dev run. */
function topInterventions(
  lineage: LineageEntry[],
  devTasks: number,
): ReportCard['topInterventions'] {
  const perRun = (entry: LineageEntry) => entry.measured.delta / devRuns(entry, devTasks);
  return lineage
    .filter((entry) => entry.decision === 'kept' && entry.measured.delta > 0)
    .sort((a, b) => perRun(b) - perRun(a) || a.round - b.round)
    .slice(0, 3)
    .map((entry) => {
      const runs = devRuns(entry, devTasks);
      return {
        round: entry.round,
        title: entry.title,
        delta: entry.measured.delta,
        ...(runs > 1 ? { runs } : {}),
      };
    });
}

/** Slack for comparing a pass rate computed from counts with a decimal target. */
const RATE_EPSILON = 1e-9;

/**
 * The graduate's report card, from its locked test and the run's record. Refusals on task types
 * the graduate doesn't refuse count as failures; refused types are flagged with the reason from
 * the frozen guardrails. Overclaim is true when the author claimed "ready" during training and
 * the test missed the requirement, and null when it never claimed.
 */
export function computeReportCard(input: ReportCardInput): ReportCard {
  const { job, run, test } = input;
  const refused = refusedTypes(input.guardrails, job);
  const refusedIds = new Set(refused.map((type) => type.type));

  const perType: TypeResult[] = job.taskTypes
    .map((type) => {
      const ofType = test.filter((result) => result.taskType === type.id);
      return {
        type: type.id,
        label: type.label,
        pass: ofType.filter((result) => result.pass).length,
        total: ofType.length,
        refused: refusedIds.has(type.id),
      };
    })
    .filter((type) => type.total > 0);

  const score = { pass: test.filter((result) => result.pass).length, total: test.length };
  const latencies = test.map((result) => result.latencyMs);
  const p95 = percentile(latencies, 95);
  const actualRate = score.total === 0 ? 0 : score.pass / score.total;
  const passRate = {
    target: job.requirements.passRate,
    actual: actualRate,
    met: actualRate + RATE_EPSILON >= job.requirements.passRate,
  };
  const latencyTarget = job.requirements.p95LatencyMs;
  const p95LatencyMs =
    latencyTarget === undefined
      ? undefined
      : { target: latencyTarget, actual: p95, met: p95 <= latencyTarget };
  const requirementsMet = passRate.met && (p95LatencyMs?.met ?? true);

  return {
    jobId: job.id,
    runId: run.id,
    method: run.method,
    name: job.name,
    createdAt: input.createdAt,
    student: input.student,
    testedOn: input.testedOn,
    mentor: input.mentor,
    test: {
      score,
      perType,
      latencyMs: { p50: percentile(latencies, 50), p95 },
      refusals: test.filter((result) => result.refused && !refusedIds.has(result.taskType)).length,
      ranOffline: input.ranOffline,
    },
    dev: { baseline: run.devBaseline, final: run.devCurrent, curve: devCurve(run, input.rounds) },
    cost: {
      mentorUsd: run.totals.mentorUsd,
      ...(input.studentUsd > 0 ? { studentUsd: input.studentUsd } : {}),
      mentorInputTokens: run.totals.mentorInputTokens,
      mentorOutputTokens: run.totals.mentorOutputTokens,
      rounds: run.totals.rounds,
      wallMs: run.totals.wallMs,
    },
    refusedTypes: refused,
    topInterventions: topInterventions(input.lineage, job.splits.dev),
    requirements: p95LatencyMs ? { passRate, p95LatencyMs } : { passRate },
    overclaim: input.readyClaimed ? !requirementsMet : null,
    ...(input.tasks === undefined ? {} : { tasks: input.tasks }),
  };
}
