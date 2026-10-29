import type { ReactNode } from 'react';
import type {
  ComparisonReport,
  GraduateSummary,
  Installation,
  Job,
  ReportCard,
  Run,
} from '@architect/shared';
import { Badge, DetailList, Disclosure, Heading, Stat, type BadgeTone } from '@architect/ui';
import { Check, CircleAlert, CircleMinus, CircleX, Cloud } from 'lucide-react';
import type { QueryState } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { formatBytes, formatDuration, formatUsd } from '../../lib/format';
import { shortModelName } from '../../lib/names';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { formatAnswerTime, formatRate, percent, signed } from '../format';
import type { ModelNames } from '../train/phase';
import { comparisonArms } from './arms';
import { Capabilities } from './Capabilities';
import type { ComparisonRow } from './comparison';
import { ComparisonArms } from './ComparisonArms';
import { Comparisons } from './Comparisons';
import { ComparisonTable } from './ComparisonTable';
import {
  runtimeFigures,
  type CapabilityEvidence,
  type ReportEvidence,
  type RuntimeFigures,
} from './evidence';
import { LocalTest } from './LocalTest';
import type { Verdict, VerdictState } from './verdict';

/** How the report names the runtime the final test ran on, behind Details. */
const RUNTIMES: Record<string, string> = {
  ollama: 'Ollama',
  openai_compatible: 'a hosted endpoint',
};

interface ReportViewProps {
  report: ReportCard;
  /** What the results say, once: from the final test and this computer's checks together. */
  verdict: Verdict;
  /** The job, for what the agent was never meant to do; null while it loads or if it failed. */
  job: Job | null;
  graduate: GraduateSummary | undefined;
  /** The other methods on the same job and seed; empty unless comparison mode is on. */
  comparison: QueryState<ComparisonRow[]>;
  /** The capability breakdown and Spark's references, read apart from the rest. */
  capabilities: QueryState<CapabilityEvidence>;
  /** The run's records beside the card: references, experiments, progress and meter readings. */
  evidence: QueryState<ReportEvidence>;
  /** The run itself, for the baseline and any trained weights it kept; null while it loads. */
  run: Run | null;
  /** This computer's install checks of the agent, once it is one. */
  installation: Installation | null;
  /** A run with no setup on the same job and seed, for the untouched student's final test. */
  bare: ReportCard | null;
  /** The comparisons runner's report this run is an arm of, when there is one. */
  comparisonReport: QueryState<ComparisonReport | null>;
  /** The run's own final test on this computer, when its own ran online and it was taken since. */
  here: ReportCard | null;
}

/** The meter's memory figures, where a meter read the final test here, for Details. */
function memoryFact(figures: RuntimeFigures | null): string | null {
  if (figures === null) return null;
  const parts = [
    figures.peakProcessBytes !== null && `${formatBytes(figures.peakProcessBytes)} of RAM`,
    figures.peakGpuBytes !== null && `${formatBytes(figures.peakGpuBytes)} of GPU memory`,
  ].filter(Boolean);
  return parts.length > 0 ? `Up to ${parts.join(' and ')}` : null;
}

/**
 * The final test before training, set against this one: a run with no setup took the same test.
 * Check tasks are other tasks, so they are never set against it; the comparisons show them.
 */
function beforeTraining(
  report: ReportCard,
  comparison: QueryState<ComparisonRow[]>,
  bare: ReportCard | null,
): string | undefined {
  if (report.method === 'bare') return undefined;
  const row = comparison.data?.find((item) => item.method === 'bare');
  const before = row ? Math.round(row.testRate) : bare ? percent(bare.test.score) : null;
  if (before === null) return undefined;
  const now = percent(report.test.score);
  const change = now > before ? 'Up from' : now < before ? 'Down from' : 'Same as';
  return `${change} ${before}% before training`;
}

/** Whether training began with a first full draft rather than a setup (decision 026). */
function startedBlank(report: ReportCard, job: Job | null): boolean {
  return (
    job?.startingHarness.kind === 'blank' &&
    (report.method === 'architect' || report.method === 'self_reflection')
  );
}

function cents(amount: number): string {
  return formatUsd(Math.round(amount * 100) / 100);
}

/**
 * What training cost in all, and each bill it is made of: Spark, the student trained online and
 * training weights, so the total is always the sum of the parts beside it.
 */
function costParts(
  report: ReportCard,
  mentor: string,
  computeUsd: number,
): { total: number; parts: string[] } {
  const { mentorUsd, studentUsd } = report.cost;
  const parts = [
    `${mentor} ${cents(mentorUsd)}`,
    studentUsd ? `Training online ${cents(studentUsd)}` : null,
    computeUsd > 0 ? `Training weights ${cents(computeUsd)}` : null,
  ].filter((part): part is string => part !== null);
  return {
    total: mentorUsd + (studentUsd ?? 0) + computeUsd,
    parts: parts.length > 1 ? parts : [],
  };
}

/** Short facts stacked one per line under a stat. */
function Lines({ lines }: { lines: readonly (string | false | undefined | null)[] }) {
  return (
    <span className="flex flex-col">
      {lines.filter(Boolean).map((line) => (
        <span key={String(line)}>{line}</span>
      ))}
    </span>
  );
}

/** How much training ran: "7 of 12 rounds · 3 h 21 min". */
function trainingNote(report: ReportCard, job: Job | null): string {
  const { rounds, wallMs } = report.cost;
  const count = job
    ? `${rounds} of ${job.budget.maxRounds} rounds`
    : `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;
  return `${count} · ${formatDuration(wallMs)}`;
}

const PILL: Record<VerdictState, { tone: BadgeTone; icon: ReactNode }> = {
  ready: { tone: 'student', icon: <Check size={14} strokeWidth={2} aria-hidden /> },
  tested_online: { tone: 'neutral', icon: <Cloud size={14} strokeWidth={1.8} aria-hidden /> },
  below_target: { tone: 'alert', icon: <CircleAlert size={14} strokeWidth={2} aria-hidden /> },
  needs_attention: { tone: 'alert', icon: <CircleAlert size={14} strokeWidth={2} aria-hidden /> },
  blocked: { tone: 'alert', icon: <CircleX size={14} strokeWidth={2} aria-hidden /> },
};

export function ReportView({
  report,
  verdict,
  job,
  graduate,
  comparison,
  capabilities,
  evidence,
  run,
  installation,
  bare,
  comparisonReport,
  here,
}: ReportViewProps) {
  const { test } = report;
  const figures = evidence.data ? runtimeFigures(evidence.data.measurements, report) : null;
  const names: ModelNames = {
    mentor: shortModelName(report.mentor.label),
    student: shortModelName(report.student.label),
  };
  const device = deviceInSentence(currentPlatform());
  const online = `on an online copy of ${names.student}`;
  const where = test.ranOffline
    ? `offline on ${device}`
    : here
      ? `${online}, and again on ${device}`
      : online;
  const bill = costParts(report, names.mentor, evidence.data?.progress.spent.computeUsd ?? 0);
  const before = beforeTraining(report, comparison, bare);
  const size = graduate?.manifest.student.sizeBytes;
  const memory = memoryFact(figures);
  const pill = PILL[verdict.state];

  return (
    <>
      <div className="flex flex-col gap-3">
        <Badge tone={pill.tone} icon={pill.icon} className="self-start">
          {verdict.pill}
        </Badge>
        <Heading as="h1" size="display">
          {verdict.title}
        </Heading>
        <p className="m-0 max-w-[660px] text-lg text-fg-secondary text-pretty">
          Tested on {test.score.total} tasks it had never seen, {where}, with {names.mentor}{' '}
          disconnected.
        </p>
        {verdict.because.length > 0 && (
          <p className="m-0 max-w-[620px] text-fg-secondary text-pretty">
            {verdict.because.join(' ')}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-px overflow-hidden rounded-2xl border border-line-card bg-line-card">
          <Stat
            className="bg-panel p-[22px]"
            value={formatRate(test.score)}
            label="of new tasks right"
            note={<Lines lines={[`${test.score.pass} of ${test.score.total}`, before]} />}
            noteFont="text"
          />
          <Stat
            className="bg-panel p-[22px]"
            value={formatAnswerTime(test.latencyMs.p50)}
            label="Typical answer"
            note={<Lines lines={[`95% within ${formatAnswerTime(test.latencyMs.p95)}`]} />}
            noteFont="text"
          />
          <Stat
            className="bg-panel p-[22px]"
            value={names.student}
            label="Model"
            note={size ? formatBytes(size) : undefined}
            noteFont="text"
          />
          <Stat
            className="bg-panel p-[22px]"
            value={cents(bill.total)}
            label="Training cost"
            note={<Lines lines={[...bill.parts, trainingNote(report, job)]} />}
            noteFont="text"
          />
        </div>
        {evidence.status === 'error' && evidence.data === undefined ? (
          // Readings that couldn't be read say so, with a way to read them again, rather than
          // vanish as if none were taken.
          <ProblemState
            layout="inline"
            error={evidence.error}
            title="Some of these figures couldn't be loaded"
            onRetry={evidence.reload}
          />
        ) : (
          <Disclosure label="Details">
            <DetailList
              items={[
                {
                  label: 'Model',
                  value: `${report.student.model} on ${RUNTIMES[report.student.runtime] ?? report.student.runtime}`,
                },
                ...(memory ? [{ label: 'Memory in the final test', value: memory }] : []),
                ...(figures !== null && figures.coldStartMs !== null
                  ? [
                      {
                        label: 'First answer',
                        value: `${formatAnswerTime(figures.coldStartMs)}, the model loading first`,
                      },
                    ]
                  : []),
              ]}
            />
          </Disclosure>
        )}
      </div>

      {report.testedOn === 'hosted' && <LocalTest report={report} />}

      <Capabilities evidence={capabilities} installation={installation} names={names} />

      {((job && job.doesNot.length > 0) || report.refusedTypes.length > 0) && (
        <section aria-labelledby="wont-do" className="flex flex-col gap-3.5">
          <Heading id="wont-do">What it won&apos;t do</Heading>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-md text-fg-secondary">
            {report.refusedTypes.map((type) => (
              <Limit key={type.type}>
                <span className="flex flex-col gap-0.5">
                  <span className="text-fg">{type.label}</span>
                  <span className="text-sm text-fg-muted text-pretty">{type.reason}</span>
                </span>
              </Limit>
            ))}
            {job?.doesNot.map((limit) => (
              <Limit key={limit}>{limit}</Limit>
            ))}
          </ul>
        </section>
      )}

      {/* A comparison's own report, when this run is one of its arms; else the run's records. */}
      {comparisonReport.status === 'error' && comparisonReport.data === undefined && (
        <section aria-labelledby="comparisons" className="flex flex-col gap-3.5">
          <Heading id="comparisons">Comparisons</Heading>
          <ProblemState
            layout="inline"
            error={comparisonReport.error}
            title="Couldn't read the comparisons"
            onRetry={comparisonReport.reload}
          />
        </section>
      )}
      {comparisonReport.data && (
        <ComparisonArms
          report={comparisonReport.data}
          runId={report.runId}
          names={names}
          testedOn={report.testedOn}
        />
      )}
      {comparisonReport.data === null &&
        evidence.status === 'error' &&
        evidence.data === undefined && (
          <section aria-labelledby="comparisons" className="flex flex-col gap-3.5">
            <Heading id="comparisons">Comparisons</Heading>
            <ProblemState
              layout="inline"
              error={evidence.error}
              title="Couldn't load the comparisons"
              onRetry={evidence.reload}
            />
          </section>
        )}
      {comparisonReport.data === null && run && evidence.data && (
        <Comparisons
          arms={comparisonArms({
            run,
            report,
            progress: evidence.data.progress,
            experiments: evidence.data.experiments,
            references: evidence.data.references,
            bare,
            figures,
          })}
          names={names}
          blankStart={job?.startingHarness.kind === 'blank'}
          checkTasks={job?.splits.dev}
        />
      )}

      {report.topInterventions.length > 0 && (
        <section aria-labelledby="helped" className="flex flex-col gap-3">
          <Heading id="helped">What helped most</Heading>
          <ol className="m-0 flex list-none flex-col p-0">
            {report.topInterventions.map((change) => (
              <li
                key={change.round}
                className="grid min-h-12 grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-card first:border-t-0"
              >
                <span className="text-fg-secondary">
                  {change.round === 1 && startedBlank(report, job)
                    ? 'First draft'
                    : `Round ${change.round}`}
                </span>
                <span className="truncate">{change.title}</span>
                <span className="font-mono text-sm tabular-nums">
                  {signed(change.runs ? change.delta / change.runs : change.delta)}{' '}
                  <span className="font-sans text-fg-muted">check tasks</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <ComparisonTable rows={comparison} names={names} />
    </>
  );
}

function Limit({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <CircleMinus
        size={16}
        strokeWidth={1.8}
        className="mt-[3px] shrink-0 text-fg-muted"
        aria-hidden
      />
      {children}
    </li>
  );
}
