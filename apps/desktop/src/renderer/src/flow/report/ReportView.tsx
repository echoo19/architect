import type { ReactNode } from 'react';
import type { GraduateSummary, Job, ReportCard } from '@architect/shared';
import { Badge, Heading, Meter, Stat } from '@architect/ui';
import { Check, CircleMinus } from 'lucide-react';
import type { QueryState } from '../../api/query';
import { formatBytes, formatDuration, formatUsd } from '../../lib/format';
import {
  capitalized,
  mentorIntro,
  quantizationLabel,
  shortModelName,
  STUDENT_ROLE,
  studentIntro,
} from '../../lib/names';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { formatAnswerTime, formatRate, percent, signed } from '../format';
import type { ModelNames } from '../train/phase';
import type { ComparisonRow } from './comparison';
import { ComparisonTable } from './ComparisonTable';
import { missedRequirements } from './requirements';

/** How the report names the runtime the final test ran on. */
const RUNTIMES: Record<string, string> = {
  ollama: 'on Ollama',
  openai_compatible: 'on a hosted endpoint',
};

interface ReportViewProps {
  report: ReportCard;
  /** The job, for what the agent was never meant to do; null while it loads or if it failed. */
  job: Job | null;
  graduate: GraduateSummary | undefined;
  /** The other methods on the same job and seed; empty unless comparison mode is on. */
  comparison: QueryState<ComparisonRow[]>;
}

/**
 * Where the "before training" number comes from: the bare baseline's final test when it ran,
 * which is the same test this report scores; otherwise the check tasks before round one.
 */
function beforeTraining(
  report: ReportCard,
  comparison: QueryState<ComparisonRow[]>,
  student: string,
): string | undefined {
  const bare = comparison.data?.find((row) => row.method === 'bare');
  if (bare && report.method !== 'bare') {
    return `Up from ${Math.round(bare.testRate)}% before training (${student} with no setup)`;
  }
  const { baseline } = report.dev;
  return baseline ? `Up from ${formatRate(baseline)} on check tasks before training` : undefined;
}

export function ReportView({ report, job, graduate, comparison }: ReportViewProps) {
  const { test, cost } = report;
  const names: ModelNames = {
    mentor: shortModelName(report.mentor.label),
    student: shortModelName(report.student.label),
  };
  const missed = missedRequirements(report);
  const handled = test.perType.filter((type) => !type.refused);
  const device = deviceInSentence(currentPlatform());
  const where = test.ranOffline ? `offline on ${device}` : 'on a hosted copy';
  const pinned = graduate?.manifest.student;
  const pinnedFacts = [
    pinned?.quantization && quantizationLabel(pinned.quantization),
    pinned?.sizeBytes ? formatBytes(pinned.sizeBytes) : undefined,
  ].filter(Boolean);
  const modelFacts =
    pinnedFacts.length > 0
      ? pinnedFacts.join(', ')
      : (RUNTIMES[report.student.runtime] ?? `on ${report.student.runtime}`);

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
          {report.name} graduated
        </Heading>
        <p className="m-0 max-w-[660px] text-lg text-fg-secondary text-pretty">
          {studentIntro(names.student)}, took a final test of {test.score.total} tasks it had never
          seen, {where}, with {mentorIntro(names.mentor)}, disconnected.
        </p>
        {missed.length > 0 && (
          <p className="m-0 max-w-[620px] text-fg-secondary text-pretty">
            Missed the target on {missed.join(' and ')}. You can still use it, or train again with
            more rounds.
          </p>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-px overflow-hidden rounded-2xl border border-line-card bg-line-card">
        <Stat
          className="bg-panel p-[22px]"
          value={formatRate(test.score)}
          label={`of new tasks right (${test.score.pass} of ${test.score.total})`}
          note={beforeTraining(report, comparison, names.student)}
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
          label={capitalized(STUDENT_ROLE)}
          note={
            <span className="flex flex-col">
              <span className="font-mono text-xs">{report.student.model}</span>
              {modelFacts}
            </span>
          }
          noteFont="text"
        />
        <Stat
          className="bg-panel p-[22px]"
          value={formatUsd(Math.round(cost.mentorUsd * 100) / 100)}
          label={`${names.mentor} mentoring, paid once`}
          note={`${cost.rounds} ${cost.rounds === 1 ? 'round' : 'rounds'} over ${formatDuration(cost.wallMs)}`}
          noteFont="text"
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-x-14 gap-y-10">
        <section aria-labelledby="handles" className="flex flex-col gap-[18px]">
          <Heading id="handles">Handles</Heading>
          {handled.length === 0 ? (
            <p className="m-0 text-md text-fg-secondary">No task type passed the final test.</p>
          ) : (
            handled.map((type) => (
              <div key={type.type} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span>{type.label}</span>
                  <span className="font-mono text-fg-secondary">
                    {formatRate(type)}
                    <span className="text-fg-muted">
                      {' '}
                      · {type.pass} of {type.total}
                    </span>
                  </span>
                </div>
                <Meter
                  label={type.label}
                  value={percent(type) / 100}
                  valueText={`${type.pass} of ${type.total} right`}
                  tone="student"
                  thickness={4}
                />
              </div>
            ))
          )}
        </section>
        <div className="flex flex-col gap-10">
          <section aria-labelledby="does-not" className="flex flex-col gap-3.5">
            <Heading id="does-not">Doesn&apos;t handle</Heading>
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
      </div>

      {report.topInterventions.length > 0 && (
        <section aria-labelledby="helped" className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-1.5">
            <Heading id="helped">What helped most</Heading>
            <p className="m-0 text-fg-secondary text-pretty">
              The changes {names.mentor} made that added the most check tasks right.
            </p>
          </div>
          <ol className="m-0 flex list-none flex-col p-0">
            {report.topInterventions.map((change) => (
              <li
                key={change.round}
                className="grid min-h-12 grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-card first:border-t-0"
              >
                <span className="text-fg-secondary">Round {change.round}</span>
                <span className="truncate">{change.title}</span>
                <span className="font-mono text-sm">
                  {signed(change.delta)}{' '}
                  <span className="font-sans text-fg-muted">
                    check {Math.abs(change.delta) === 1 ? 'task' : 'tasks'}
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
        Nothing. It takes on every kind of task it trained on.
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
