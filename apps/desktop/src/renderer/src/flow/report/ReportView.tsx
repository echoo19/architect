import type { ReactNode } from 'react';
import {
  type ComparisonReport,
  type GraduateSummary,
  type Installation,
  type Job,
  type ReportCard,
  type Run,
} from '@architect/shared';
import { DetailList, Disclosure, Heading, Stagger, StaggerItem, Stat } from '@architect/ui';
import { CircleMinus } from 'lucide-react';
import type { QueryState } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { formatBytes, formatDuration, formatUsd } from '../../lib/format';
import { shortModelName } from '../../lib/names';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { formatAnswerTime, formatRate, percent, signed } from '../format';
import { Section } from '../ledger';
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
import { RuleNotes } from './RuleNotes';
import { ScoreNotes } from './ScoreNotes';
import { testSourceNote } from './test-source';
import type { Verdict } from './verdict';

/** How the report names the runtime the final test ran on, in the run's details. */
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

/** The meter's memory figures, where a meter read the final test here, for the run's details. */
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
  const source = testSourceNote(report.tasks, names.mentor);

  return (
    <Stagger className="flex flex-col gap-12">
      <StaggerItem>
        <header className="flex flex-col gap-3">
          <Heading as="h1" size="display">
            {verdict.title}
          </Heading>
          <p className="m-0 max-w-[660px] text-body text-pretty">
            Tested on {test.score.total} tasks it had never seen, {where}, with {names.mentor}{' '}
            disconnected.
          </p>
          {verdict.because.length > 0 && (
            <p className="m-0 max-w-[620px] text-pretty">{verdict.because.join(' ')}</p>
          )}
        </header>
      </StaggerItem>

      {/* An agent tested online is offered the test on this computer where its verdict says so. */}
      {report.testedOn === 'hosted' && (
        <StaggerItem>
          <LocalTest report={report} />
        </StaggerItem>
      )}

      <StaggerItem className="flex flex-col gap-6">
        <div className="grid grid-cols-2 items-baseline gap-x-12 gap-y-8 border-y border-line py-8 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <Stat
            size="xl"
            value={formatRate(test.score)}
            label="of new tasks right"
            note={<Lines lines={[`${test.score.pass} of ${test.score.total}`, before]} />}
            noteFont="text"
          />
          <Stat
            value={formatAnswerTime(test.latencyMs.p50)}
            label="Typical answer time"
            noteFont="text"
          />
          {size ? (
            <Stat value={names.student} label={`${formatBytes(size)} on disk`} noteFont="text" />
          ) : null}
          <Stat value={cents(bill.total)} label="Training cost" noteFont="text" />
        </div>
        <ScoreNotes rules={report.tasks?.rules} teacher={names.mentor} />
        {evidence.status === 'error' && evidence.data === undefined && (
          // Readings that couldn't be read say so, with a way to read them again, rather than
          // vanish as if none were taken.
          <ProblemState
            layout="inline"
            error={evidence.error}
            title="Some of these figures couldn't be loaded"
            onRetry={evidence.reload}
          />
        )}
      </StaggerItem>

      <StaggerItem>
        <Capabilities evidence={capabilities} installation={installation} names={names} />
      </StaggerItem>

      {((job && job.doesNot.length > 0) || report.refusedTypes.length > 0) && (
        <StaggerItem>
          <Section title="What it won't do" id="wont-do">
            <ul className="m-0 list-none border-b border-line p-0">
              {report.refusedTypes.map((type) => (
                <Limit key={type.type} reason={type.reason}>
                  {type.label}
                </Limit>
              ))}
              {job?.doesNot.map((limit) => (
                <Limit key={limit}>{limit}</Limit>
              ))}
            </ul>
          </Section>
        </StaggerItem>
      )}

      {/* A comparison's own report, when this run is one of its arms; else the run's records. */}
      {comparisonReport.status === 'error' && comparisonReport.data === undefined && (
        <StaggerItem>
          <Section title="Comparisons" id="comparisons">
            <ProblemState
              layout="inline"
              error={comparisonReport.error}
              title="Couldn't read the comparisons"
              onRetry={comparisonReport.reload}
            />
          </Section>
        </StaggerItem>
      )}
      {comparisonReport.data && (
        <StaggerItem>
          <ComparisonArms
            report={comparisonReport.data}
            runId={report.runId}
            names={names}
            testedOn={report.testedOn}
          />
        </StaggerItem>
      )}
      {comparisonReport.data === null &&
        evidence.status === 'error' &&
        evidence.data === undefined && (
          <StaggerItem>
            <Section title="Comparisons" id="comparisons">
              <ProblemState
                layout="inline"
                error={evidence.error}
                title="Couldn't load the comparisons"
                onRetry={evidence.reload}
              />
            </Section>
          </StaggerItem>
        )}
      {comparisonReport.data === null && run && evidence.data && (
        <StaggerItem>
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
        </StaggerItem>
      )}

      {report.topInterventions.length > 0 && (
        <StaggerItem>
          <Section title="What helped most" id="helped">
            <div className="border-b border-line">
              <table className="w-full border-collapse text-ui">
                <thead>
                  <tr className="text-small">
                    <th className="w-24 pb-3" />
                    <th className="pb-3" />
                    <th className="pb-3 pl-6 text-right font-normal">Check tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topInterventions.map((change) => (
                    <tr key={change.round} className="border-t border-line">
                      <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                        {change.round === 1 && startedBlank(report, job)
                          ? 'First draft'
                          : `Round ${change.round}`}
                      </th>
                      <td className="py-3.5 pr-4">{change.title}</td>
                      <td className="py-3.5 pl-6 text-right font-mono tabular-nums">
                        {signed(change.runs ? change.delta / change.runs : change.delta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </StaggerItem>
      )}

      <StaggerItem className="empty:hidden">
        <ComparisonTable rows={comparison} names={names} />
      </StaggerItem>

      <StaggerItem>
        <Disclosure label="Run details">
          <DetailList
            items={[
              {
                label: 'Model',
                value: `${report.student.model} on ${RUNTIMES[report.student.runtime] ?? report.student.runtime}`,
              },
              { label: 'Answer time', value: `95% within ${formatAnswerTime(test.latencyMs.p95)}` },
              { label: 'Training', value: trainingNote(report, job) },
              ...(bill.parts.length > 0 ? [{ label: 'Cost', value: bill.parts.join(' · ') }] : []),
              ...(memory ? [{ label: 'Memory in the final test', value: memory }] : []),
              ...(figures !== null && figures.coldStartMs !== null
                ? [
                    {
                      label: 'First answer',
                      value: `${formatAnswerTime(figures.coldStartMs)}, the model loading first`,
                    },
                  ]
                : []),
              ...(report.tasks?.draftingUsd
                ? [
                    {
                      label: 'Drafting the job',
                      value: `${cents(report.tasks.draftingUsd)}, before training`,
                    },
                  ]
                : []),
            ]}
          />
          {source && <p className="m-0 mt-3 max-w-[620px] text-small text-pretty">{source}</p>}
          {report.tasks?.rules && (
            <RuleNotes rules={report.tasks.rules} rounds={report.cost.rounds} />
          )}
        </Disclosure>
      </StaggerItem>
    </Stagger>
  );
}

/** One thing the agent leaves to its person, and when the engine says why, why. */
function Limit({ reason, children }: { reason?: string; children: ReactNode }) {
  return (
    <li className="grid min-h-12 grid-cols-[16px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-t border-line py-3 sm:grid-cols-[16px_minmax(0,220px)_minmax(0,1fr)]">
      <CircleMinus size={16} strokeWidth={1.8} className="shrink-0" aria-hidden />
      <span className={reason === undefined ? 'sm:col-span-2' : undefined}>{children}</span>
      {reason !== undefined && (
        <span className="col-start-2 text-small text-pretty sm:col-start-3">{reason}</span>
      )}
    </li>
  );
}
