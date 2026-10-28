import type { ReactNode } from 'react';
import type { GraduateSummary, Installation, Job, ReportCard, Run } from '@architect/shared';
import { Badge, ErrorState, Heading, Stat } from '@architect/ui';
import { Check, CircleMinus } from 'lucide-react';
import type { QueryState } from '../../api/query';
import { formatBytes, formatDuration, formatUsd } from '../../lib/format';
import { quantizationLabel, shortModelName } from '../../lib/names';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { providerName } from '../define/hosted';
import { formatAnswerTime, formatRate, percent, signed } from '../format';
import type { ModelNames } from '../train/phase';
import { comparisonArms } from './arms';
import { Capabilities } from './Capabilities';
import type { ComparisonRow } from './comparison';
import { Comparisons } from './Comparisons';
import { ComparisonTable } from './ComparisonTable';
import type { ReportEvidence } from './evidence';
import { missedRequirements } from './requirements';

/** How the report names the runtime the final test ran on. */
const RUNTIMES: Record<string, string> = {
  ollama: 'Ollama',
  openai_compatible: 'Hosted endpoint',
};

interface ReportViewProps {
  report: ReportCard;
  /** The job, for what the agent was never meant to do; null while it loads or if it failed. */
  job: Job | null;
  graduate: GraduateSummary | undefined;
  /** The other methods on the same job and seed; empty unless comparison mode is on. */
  comparison: QueryState<ComparisonRow[]>;
  /** The run's records beside the card: capabilities, references, experiments and progress. */
  evidence: QueryState<ReportEvidence>;
  /** The run itself, for the baseline and any trained weights it kept; null while it loads. */
  run: Run | null;
  /** This computer's install checks of the agent, once it is one. */
  installation: Installation | null;
  /** A run with no setup on the same job and seed, for the untouched student's final test. */
  bare: ReportCard | null;
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
  return `${change} ${before}% with no setup`;
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

/** Each bill on its own, "Spark $0.41" and "OpenRouter $3.20", when a hosted copy was paid for. */
function costParts(report: ReportCard, mentor: string, job: Job | null): string[] {
  const { mentorUsd, studentUsd } = report.cost;
  if (!studentUsd) return [];
  const host = job?.student.hosted ? providerName(job.student.hosted) : 'Hosted copy';
  return [`${mentor} ${cents(mentorUsd)}`, `${host} ${cents(studentUsd)}`];
}

/** Short facts stacked one per line under a stat. */
function Lines({ lines }: { lines: readonly (string | false | undefined)[] }) {
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
  job,
  graduate,
  comparison,
  evidence,
  run,
  installation,
  bare,
}: ReportViewProps) {
  const { test, cost } = report;
  const names: ModelNames = {
    mentor: shortModelName(report.mentor.label),
    student: shortModelName(report.student.label),
  };
  const missed = missedRequirements(report);
  const device = deviceInSentence(currentPlatform());
  const where = test.ranOffline ? `offline on ${device}` : 'on a hosted copy';
  const spent = costParts(report, names.mentor, job);
  const before = beforeTraining(report, comparison, bare);
  const pinned = graduate?.manifest.student;
  const pinnedFacts = [
    pinned?.quantization && quantizationLabel(pinned.quantization),
    pinned?.sizeBytes ? formatBytes(pinned.sizeBytes) : undefined,
  ].filter(Boolean);
  const modelFacts =
    pinnedFacts.length > 0
      ? pinnedFacts.join(' · ')
      : (RUNTIMES[report.student.runtime] ?? report.student.runtime);

  return (
    <>
      <div className="flex flex-col gap-3">
        {missed.length === 0 ? (
          <Badge
            tone="student"
            icon={<Check size={14} strokeWidth={2} aria-hidden />}
            className="self-start"
          >
            Ready
          </Badge>
        ) : (
          <Badge className="self-start">Below target</Badge>
        )}
        <Heading as="h1" size="display">
          {/* It graduates by meeting the job's targets on the final test; short of them it's
              finished training, and still there to use. */}
          {missed.length === 0 ? `${report.name} graduated` : `${report.name} finished training`}
        </Heading>
        <p className="m-0 max-w-[660px] text-lg text-fg-secondary text-pretty">
          Final test of {test.score.total} unseen tasks, {where}, with {names.mentor} disconnected.
        </p>
        {missed.length > 0 && (
          <p className="m-0 max-w-[620px] text-fg-secondary text-pretty">
            Missed the target on {missed.join(' and ')}. You can still use it, or train again.
          </p>
        )}
      </div>

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
          note={`95% within ${formatAnswerTime(test.latencyMs.p95)}`}
          noteFont="text"
        />
        <Stat
          className="bg-panel p-[22px]"
          value={names.student}
          label="Model"
          note={modelFacts}
          noteFont="text"
        />
        <Stat
          className="bg-panel p-[22px]"
          value={cents(cost.mentorUsd + (cost.studentUsd ?? 0))}
          label={cost.studentUsd ? 'Training cost' : `${names.mentor} mentoring`}
          note={<Lines lines={[...spent, trainingNote(report, job)]} />}
          noteFont="text"
        />
      </div>

      <Capabilities evidence={evidence} installation={installation} names={names} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-x-14 gap-y-10">
        <section aria-labelledby="does-not" className="flex flex-col gap-3.5">
          <Heading id="does-not">Task types it turns down</Heading>
          <Refused report={report} />
        </section>
        {job && job.doesNot.length > 0 && (
          <section aria-labelledby="wont-do" className="flex flex-col gap-3.5">
            <Heading id="wont-do">What it won&apos;t do</Heading>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-md text-fg-secondary">
              {job.doesNot.map((limit) => (
                <Limit key={limit}>{limit}</Limit>
              ))}
            </ul>
          </section>
        )}
      </div>

      {evidence.status === 'error' && evidence.data === undefined && (
        <section aria-labelledby="comparisons" className="flex flex-col gap-3.5">
          <Heading id="comparisons">Comparisons</Heading>
          <ErrorState
            layout="inline"
            title="Couldn't load the comparisons"
            message={evidence.error.message}
            onRetry={evidence.reload}
          />
        </section>
      )}
      {run && evidence.data && (
        <Comparisons
          arms={comparisonArms({
            run,
            report,
            progress: evidence.data.progress,
            experiments: evidence.data.experiments,
            references: evidence.data.references,
            bare,
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
                  <span className="font-sans text-fg-muted">
                    check tasks
                    {change.runs ? `, average of ${change.runs} measurements` : null}
                  </span>
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

/** Task types the agent refuses, each with the reason from its guardrails. */
function Refused({ report }: { report: ReportCard }) {
  if (report.refusedTypes.length === 0) {
    return (
      <p className="m-0 text-md text-fg-secondary">
        None. It takes on every task type it trained on.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-md text-fg-secondary">
      {report.refusedTypes.map((type) => (
        <Limit key={type.type}>
          <span className="flex flex-col gap-0.5">
            <span className="text-fg">{type.label}</span>
            <span className="text-sm text-fg-muted text-pretty">{type.reason}</span>
          </span>
        </Limit>
      ))}
    </ul>
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
