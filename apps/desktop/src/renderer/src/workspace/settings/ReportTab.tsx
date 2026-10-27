import type { GraduateSummary, ReportCard } from '@architect/shared';
import { ErrorState, Heading, Meter, Skeleton, Stat } from '@architect/ui';
import { useReport } from '../../api/hooks';
import { formatAnswerTime } from '../../flow/format';
import { formatPercent, formatUsd, percentOf } from '../../lib/format';
import { shortModelName } from '../../lib/names';

/** The agent's report card in brief: how it did on the locked test, and what it refuses. */
export function ReportTab({ agent }: { agent: GraduateSummary }) {
  const report = useReport(agent.manifest.runId);
  if (report.status === 'error') {
    return (
      <ErrorState
        title="Couldn't load the report card"
        message={report.error.message}
        onRetry={report.reload}
        className="py-12"
      />
    );
  }
  if (report.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading the report card" className="flex flex-col gap-7">
        <Skeleton className="h-[116px] w-full rounded-2xl" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }
  return <ReportSummary report={report.data} />;
}

function ReportSummary({ report }: { report: ReportCard }) {
  const { test, cost, requirements } = report;
  const handled = test.perType.filter((type) => !type.refused);
  const cell = 'bg-modal p-[18px]';

  return (
    <div className="flex flex-col gap-8 pt-1">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px overflow-hidden rounded-2xl border border-line-card bg-line-card">
        <Stat
          className={cell}
          value={formatPercent(test.score)}
          label="of new tasks right"
          note={`${test.score.pass} of ${test.score.total}, target ${Math.round(
            requirements.passRate.target * 100,
          )}%`}
          noteFont="text"
        />
        <Stat
          className={cell}
          value={formatAnswerTime(test.latencyMs.p50)}
          label="Typical answer"
          note={`95% within ${formatAnswerTime(test.latencyMs.p95)}`}
          noteFont="text"
        />
        <Stat
          className={cell}
          value={formatUsd(cost.mentorUsd)}
          label={`${shortModelName(report.mentor.label)} mentoring`}
          note={`${cost.rounds} rounds, paid once`}
          noteFont="text"
        />
      </div>

      <section className="flex flex-col gap-4">
        <Heading>Handles</Heading>
        {handled.map((type) => (
          <div key={type.type} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span>{type.label}</span>
              <span className="font-mono text-fg-secondary">
                {formatPercent(type)}
                <span className="text-fg-muted">
                  {' '}
                  · {type.pass} of {type.total}
                </span>
              </span>
            </div>
            <Meter label={type.label} value={percentOf(type) / 100} tone="student" thickness={4} />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <Heading>Doesn&apos;t handle</Heading>
        {report.refusedTypes.length === 0 ? (
          <p className="m-0 text-fg-secondary">
            Nothing. It takes on every task type it trained on.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {report.refusedTypes.map((type) => {
              // Refused test tasks count as failures, so they show like the scores above.
              const result = test.perType.find((item) => item.type === type.type);
              return (
                <li key={type.type} className="flex flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-3 text-fg-secondary">
                    {type.label}
                    {result && (
                      <span className="font-mono text-fg-muted">
                        {result.pass} of {result.total}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-fg-muted text-pretty">{type.reason}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
