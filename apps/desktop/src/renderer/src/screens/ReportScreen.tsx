import { useState } from 'react';
import type { ReportCard } from '@architect/shared';
import { Badge, Button, ErrorState, Heading, Meter, Skeleton, Stat } from '@architect/ui';
import { ArrowRight, Check } from 'lucide-react';
import { api, architect } from '../api/client';
import { createChat, queryKeys, useReport } from '../api/hooks';
import { fetchQuery } from '../api/query';
import { formatDuration, formatPercent, formatSeconds, formatUsd, percentOf } from '../lib/format';
import { shortModelName } from '../lib/names';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

/** Step four: how the graduate did on the locked test, and accepting it into the workspace. */
export function ReportScreen({ runId }: { runId: string }) {
  const report = useReport(runId);
  const [accepting, setAccepting] = useState(false);

  const accept = async () => {
    setAccepting(true);
    const opened = await attempt("Couldn't add the agent to your workspace", async () => {
      const graduate = await architect().graduates.accept(runId);
      await fetchQuery(queryKeys.graduates, api.graduates);
      const chat = await createChat(graduate.id);
      return { graduateId: graduate.id, chatId: chat.id };
    });
    setAccepting(false);
    if (opened) navigate(paths.chat(opened.graduateId, opened.chatId));
  };

  return (
    <FlowShell
      title={report.data?.name ?? 'Report'}
      step="Graduate"
      footer={
        report.status === 'success' && (
          <div className="mx-auto flex max-w-[860px] flex-wrap justify-end gap-2">
            <Button onClick={() => navigate(paths.train(runId))}>See all rounds</Button>
            <Button variant="primary" loading={accepting} onClick={accept}>
              Start using {report.data.name}
              <ArrowRight size={16} strokeWidth={2} aria-hidden />
            </Button>
          </div>
        )
      }
    >
      <div className="mx-auto box-content flex max-w-[860px] flex-col gap-11 px-8 pb-8 pt-14">
        {report.status === 'loading' && <ReportSkeleton />}
        {report.status === 'error' && (
          <ErrorState
            title="Couldn't load the report"
            message={report.error.message}
            onRetry={report.reload}
            secondaryAction={
              <Button size="md" onClick={() => navigate(paths.home())}>
                Back to agents
              </Button>
            }
            className="min-h-[60vh]"
          />
        )}
        {report.status === 'success' && <ReportOverview report={report.data} />}
      </div>
    </FlowShell>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the report" className="flex flex-col gap-11">
      <div className="flex flex-col gap-3">
        <Skeleton shape="pill" className="h-7 w-20" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-[136px] w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-14">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

function ReportOverview({ report }: { report: ReportCard }) {
  const { test, cost, requirements } = report;
  const ready = requirements.passRate.met;
  const handled = test.perType.filter((type) => !type.refused);

  return (
    <>
      <div className="flex flex-col gap-3">
        {ready ? (
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
          {ready ? `${report.name} graduated` : `${report.name} finished training`}
        </Heading>
        <p className="m-0 max-w-[620px] text-lg text-fg-secondary text-pretty">
          {test.score.total} unseen tasks, {test.ranOffline ? 'offline, ' : ''}on{' '}
          {deviceInSentence(currentPlatform())}.
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-px overflow-hidden rounded-2xl border border-line-card bg-line-card">
        <Stat
          className="bg-panel p-[22px]"
          value={formatPercent(test.score)}
          label="Task success"
          note={`Target ${Math.round(requirements.passRate.target * 100)}%`}
        />
        <Stat
          className="bg-panel p-[22px]"
          value={formatSeconds(test.latencyMs.p50)}
          label="Typical answer"
          note={`Slowest ${formatSeconds(test.latencyMs.p95)}`}
        />
        <Stat
          className="bg-panel p-[22px]"
          value={formatUsd(cost.mentorUsd)}
          label={`${shortModelName(report.mentor.label)} mentoring`}
          note={`${formatDuration(cost.wallMs)} · ${cost.rounds} rounds`}
        />
        <Stat
          className="bg-panel p-[22px]"
          value={String(test.refusals)}
          label="Refused"
          note="Counted as failures"
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] gap-x-14 gap-y-10">
        <section className="flex flex-col gap-[18px]">
          <Heading>Handles</Heading>
          {handled.map((type) => (
            <div key={type.type} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span>{type.label}</span>
                <span className="font-mono text-fg-secondary">{formatPercent(type)}</span>
              </div>
              <Meter
                label={type.label}
                value={percentOf(type) / 100}
                tone="student"
                thickness={4}
              />
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-3.5">
          <Heading>Doesn&apos;t handle</Heading>
          {report.refusedTypes.length === 0 ? (
            <p className="m-0 text-md text-fg-secondary">Nothing was refused.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {report.refusedTypes.map((type) => (
                <li key={type.type} className="flex flex-col gap-0.5">
                  <span className="text-md text-fg-secondary">{type.label}</span>
                  <span className="text-sm text-fg-muted text-pretty">{type.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
