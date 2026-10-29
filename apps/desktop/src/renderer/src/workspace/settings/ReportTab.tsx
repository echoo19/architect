import type { GraduateSummary, ReportCard } from '@architect/shared';
import { Heading, Meter, Skeleton, Stat } from '@architect/ui';
import { useVersionReport, useVersions } from '../../api/graduates';
import { ProblemState } from '../../components/ProblemState';
import { formatAnswerTime } from '../../flow/format';
import { AUTHOR_RESULT_TITLE } from '../../install/labels';
import { formatPercent, formatUsd, percentOf } from '../../lib/format';
import { shortModelName } from '../../lib/names';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { useAgentSettingsUi } from './agentSettingsUi';

/**
 * The report card of the version chats run on, in brief: how it did on its locked test, and
 * what it refuses. A version from another computer says the result is its author's.
 */
export function ReportTab({ agent }: { agent: GraduateSummary }) {
  const report = useVersionReport(agent);
  const versions = useVersions(agent.id);
  const imported = versions.data?.find((version) => version.active)?.origin !== undefined;
  if (report.status === 'error') {
    return (
      <ProblemState
        error={report.error}
        title="Couldn't load the results"
        onRetry={report.reload}
        exit={{
          label: 'See earlier versions',
          onClick: () => useAgentSettingsUi.getState().setTab('teaching'),
        }}
        className="py-12"
      />
    );
  }
  if (report.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading the results" className="flex flex-col gap-7">
        <Skeleton className="h-[116px] w-full rounded-2xl" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }
  return <ReportSummary report={report.data} imported={imported} />;
}

function ReportSummary({ report, imported }: { report: ReportCard; imported: boolean }) {
  const { test, cost, requirements } = report;
  const handled = test.perType.filter((type) => !type.refused);
  const cell = 'bg-modal p-[18px]';
  const place = imported
    ? "on the author's computer"
    : test.ranOffline
      ? `on ${deviceInSentence(currentPlatform())}`
      : 'on a hosted copy';

  return (
    <div className="flex flex-col gap-8 pt-1">
      {imported && <span className="-mb-5 text-sm text-fg-muted">{AUTHOR_RESULT_TITLE}</span>}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line-card bg-line-card">
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
          label={`Typical answer, ${place}`}
          note={`95% of answers within ${formatAnswerTime(test.latencyMs.p95)}`}
          noteFont="text"
        />
        <Stat
          className={`${cell} col-span-2`}
          value={formatUsd(Math.round((cost.mentorUsd + (cost.studentUsd ?? 0)) * 100) / 100)}
          label={
            cost.studentUsd ? 'Training cost' : `${shortModelName(report.mentor.label)} mentoring`
          }
          note={
            cost.studentUsd
              ? `${shortModelName(report.mentor.label)} ${formatUsd(Math.round(cost.mentorUsd * 100) / 100)}, hosted copy ${formatUsd(Math.round(cost.studentUsd * 100) / 100)}; ${cost.rounds} rounds, paid once`
              : `${cost.rounds} rounds, paid once`
          }
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
            {percentOf(type) < Math.round(requirements.passRate.target * 100) && (
              <span className="text-sm text-fg-muted">
                Below the {Math.round(requirements.passRate.target * 100)}% target on its own: check
                these answers before relying on them
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Heading>Doesn&apos;t handle</Heading>
          <p className="m-0 text-sm text-fg-muted">Requests it turns down and leaves to you.</p>
        </div>
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
