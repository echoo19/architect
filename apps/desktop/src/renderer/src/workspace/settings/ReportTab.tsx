import type { ReactNode } from 'react';
import type { GraduateSummary, ReportCard } from '@architect/shared';
import { Heading, Meter, SettingsRow, Skeleton } from '@architect/ui';
import { useVersionReport, useVersions } from '../../api/graduates';
import { ProblemState } from '../../components/ProblemState';
import { formatAnswerTime } from '../../flow/format';
import { LocalTest } from '../../flow/report/LocalTest';
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
        <Skeleton className="h-[116px] w-full rounded-card" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }
  return <ReportSummary report={report.data} imported={imported} />;
}

/** One result as a row: its figure in the display face, and what it is out of beside it. */
function Figure({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <SettingsRow label={label}>
      <span className="flex items-baseline gap-3">
        <span className="font-display text-h2 font-semibold tabular-nums">{value}</span>
        <span className="text-small tabular-nums">{children}</span>
      </span>
    </SettingsRow>
  );
}

function ReportSummary({ report, imported }: { report: ReportCard; imported: boolean }) {
  const { test, cost, requirements } = report;
  const handled = test.perType.filter((type) => !type.refused);
  const place = imported
    ? "on the author's computer"
    : test.ranOffline
      ? `on ${deviceInSentence(currentPlatform())}`
      : 'on the online copy';

  return (
    <div className="flex flex-col gap-8 pt-1">
      {imported && <span className="-mb-5 text-small text-fg">{AUTHOR_RESULT_TITLE}</span>}
      <div>
        <Figure label="Of new tasks right" value={formatPercent(test.score)}>
          {test.score.pass} of {test.score.total} · target{' '}
          {Math.round(requirements.passRate.target * 100)}%
        </Figure>
        <Figure label={`Typical answer, ${place}`} value={formatAnswerTime(test.latencyMs.p50)}>
          95% within {formatAnswerTime(test.latencyMs.p95)}
        </Figure>
        <Figure
          label={
            cost.studentUsd ? 'Training cost' : `${shortModelName(report.mentor.label)} mentoring`
          }
          value={formatUsd(Math.round((cost.mentorUsd + (cost.studentUsd ?? 0)) * 100) / 100)}
        >
          {cost.rounds} rounds
        </Figure>
      </div>

      {!imported && report.testedOn === 'hosted' && <LocalTest report={report} />}

      <section className="flex flex-col gap-4">
        <Heading>Handles</Heading>
        {handled.map((type) => (
          <div key={type.type} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span>{type.label}</span>
              <span className="font-mono text-fg">
                {formatPercent(type)}
                <span className="text-fg">
                  {' '}
                  · {type.pass} of {type.total}
                </span>
              </span>
            </div>
            <Meter label={type.label} value={percentOf(type) / 100} tone="student" thickness={4} />
            {percentOf(type) < Math.round(requirements.passRate.target * 100) && (
              <span className="text-small text-fg">
                Below the {Math.round(requirements.passRate.target * 100)}% target on its own: check
                these answers before relying on them
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <Heading>Doesn&apos;t handle</Heading>
        {report.refusedTypes.length === 0 ? (
          <p className="m-0 text-fg">Nothing. It takes on every task type it trained on.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {report.refusedTypes.map((type) => {
              // Refused test tasks count as failures, so they show like the scores above.
              const result = test.perType.find((item) => item.type === type.type);
              return (
                <li key={type.type} className="flex flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-3 text-fg">
                    {type.label}
                    {result && (
                      <span className="font-mono text-fg">
                        {result.pass} of {result.total}
                      </span>
                    )}
                  </span>
                  <span className="text-small text-fg text-pretty">{type.reason}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
