import type { ReactNode } from 'react';
import type { GraduateSummary, Job, ReportCard } from '@architect/shared';
import { Badge, Heading, Meter, Stat } from '@architect/ui';
import { Check, CircleMinus } from 'lucide-react';
import { formatBytes, formatDuration, formatUsd } from '../../lib/format';
import { shortModelName } from '../../lib/names';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { formatAnswerTime, formatRate, percent, signed } from '../format';
import { ComparisonTable } from './ComparisonTable';
import { missedRequirements } from './requirements';

/** How the report names the runtime the final test ran on. */
const RUNTIMES: Record<string, string> = {
  ollama: 'Runs on Ollama',
  openai_compatible: 'Runs on a hosted endpoint',
};

interface ReportViewProps {
  report: ReportCard;
  /** The job, for what the agent was never meant to do; null while it loads or if it failed. */
  job: Job | null;
  graduate: GraduateSummary | undefined;
  comparisonMode: boolean;
}

export function ReportView({ report, job, graduate, comparisonMode }: ReportViewProps) {
  const { test, cost, dev } = report;
  const mentor = shortModelName(report.mentor.label);
  const missed = missedRequirements(report);
  const handled = test.perType.filter((type) => !type.refused);
  const where = test.ranOffline
    ? `offline, on ${deviceInSentence(currentPlatform())}`
    : 'on a hosted copy';
  const pinned = graduate?.manifest.student;
  const modelFacts = [
    pinned?.quantization,
    pinned?.sizeBytes ? formatBytes(pinned.sizeBytes) : undefined,
  ].filter(Boolean);

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
        <p className="m-0 max-w-[620px] text-lg text-fg-secondary text-pretty">
          {test.score.total} new tasks, {where}, {mentor} disconnected.
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
          label="Task success"
          note={dev.baseline ? `${formatRate(dev.baseline)} before training` : undefined}
        />
        <Stat
          className="bg-panel p-[22px]"
          value={formatAnswerTime(test.latencyMs.p50)}
          label="Typical answer"
          note={`Slowest ${formatAnswerTime(test.latencyMs.p95)}`}
        />
        <Stat
          className="bg-panel p-[22px]"
          value={shortModelName(report.student.label)}
          label={report.student.model}
          note={
            modelFacts.length > 0
              ? modelFacts.join(' · ')
              : (RUNTIMES[report.student.runtime] ?? `Runs on ${report.student.runtime}`)
          }
        />
        <Stat
          className="bg-panel p-[22px]"
          value={formatUsd(Math.round(cost.mentorUsd * 100) / 100)}
          label={`${mentor} mentoring`}
          note={`${formatDuration(cost.wallMs)} · ${cost.rounds} ${cost.rounds === 1 ? 'round' : 'rounds'}`}
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
                  <span className="font-mono text-fg-secondary">{formatRate(type)}</span>
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
        <section aria-labelledby="does-not" className="flex flex-col gap-3.5">
          <Heading id="does-not">Doesn&apos;t handle</Heading>
          <DoesNotHandle report={report} job={job} />
        </section>
      </div>

      {report.topInterventions.length > 0 && (
        <section aria-labelledby="helped" className="flex flex-col gap-[18px]">
          <Heading id="helped">What helped most</Heading>
          <ol className="m-0 flex list-none flex-col p-0">
            {report.topInterventions.map((change) => (
              <li
                key={change.round}
                className="grid min-h-12 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-card first:border-t-0"
              >
                <span className="font-mono text-fg-secondary">
                  {String(change.round).padStart(2, '0')}
                </span>
                <span className="truncate">{change.title}</span>
                <span className="font-mono text-sm">
                  {signed(change.delta)}{' '}
                  <span className="text-fg-muted">
                    check {Math.abs(change.delta) === 1 ? 'task' : 'tasks'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {comparisonMode && <ComparisonTable report={report} mentor={mentor} />}
    </>
  );
}

function DoesNotHandle({ report, job }: { report: ReportCard; job: Job | null }) {
  const limits = job?.doesNot ?? [];
  if (report.refusedTypes.length === 0 && limits.length === 0) {
    return (
      <p className="m-0 text-md text-fg-secondary">It took on every kind of task it was given.</p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-md text-fg-secondary">
      {report.refusedTypes.map((type) => (
        <Limit key={type.type}>
          <span className="flex flex-col gap-0.5">
            {type.label}
            <span className="text-sm text-fg-muted text-pretty">{type.reason}</span>
          </span>
        </Limit>
      ))}
      {limits.map((limit) => (
        <Limit key={limit}>{limit}</Limit>
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
