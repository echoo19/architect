import { useState, type ReactNode } from 'react';
import type { RunDetail, RunImprovement } from '@architect/shared';
import { Button, EmptyState, ErrorState, Skeleton } from '@architect/ui';
import { ArrowUpRight, TrendingUp } from 'lucide-react';
import { useVersions } from '../api/graduates';
import { ProblemState } from '../components/ProblemState';
import { useGraduates, useRunDetail } from '../api/hooks';
import {
  refreshTeaching,
  useCorrections,
  useFreshTeaching,
  useImprovements,
} from '../api/teaching';
import { ImprovementView } from '../flow/improve/ImprovementView';
import { modelNames } from '../flow/names';
import { navigate, paths } from '../lib/router';
import { FlowShell, IMPROVE_STEPS } from '../shell/FlowShell';
import { MoveDialog } from '../workspace/settings/MoveDialog';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { runningImprovement } from '../workspace/teach/lessons';

function Page({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <FlowShell<string> title={title} step="Report" steps={IMPROVE_STEPS} footer={footer}>
      <div className="mx-auto box-content flex max-w-[860px] flex-col gap-11 px-8 pb-8 pt-14">
        {children}
      </div>
    </FlowShell>
  );
}

/**
 * What Improve agent changed: its new version against the one it started from, on the check
 * tasks, with whether the new version may be used and a way to use it.
 */
export function ImprovementScreen({ runId }: { runId: string }) {
  const detail = useRunDetail(runId);
  const loaded = detail.data;
  if (loaded?.improves) return <Loaded runId={runId} detail={loaded} improves={loaded.improves} />;
  return (
    <Page title={loaded?.job.name ?? 'Improvement'}>
      {loaded ? (
        <ErrorState
          title="This run didn't improve an agent"
          message="It trained a new one, and its report card says how that went."
          secondaryAction={
            <Button size="md" onClick={() => navigate(paths.report(runId))}>
              See the report card
            </Button>
          }
          className="min-h-[60vh]"
        />
      ) : detail.status === 'error' ? (
        <ProblemState
          error={detail.error}
          title="Couldn't load what it changed"
          onRetry={detail.reload}
          exit={{ label: 'Back to agents', onClick: () => navigate(paths.home()) }}
          className="min-h-[60vh]"
        />
      ) : (
        <ImprovementSkeleton />
      )}
    </Page>
  );
}

function Loaded({
  runId,
  detail,
  improves,
}: {
  runId: string;
  detail: RunDetail;
  improves: RunImprovement;
}) {
  const improvements = useImprovements(improves.graduateId);
  const corrections = useCorrections(improves.graduateId);
  useFreshTeaching(improves.graduateId);
  const versions = useVersions(improves.graduateId);
  const graduates = useGraduates();
  const showSettings = useAgentSettingsUi((state) => state.show);
  const [promoting, setPromoting] = useState(false);
  const improvement = improvements.data?.find((item) => item.runId === runId);
  const agent = graduates.data?.find((graduate) => graduate.id === improves.graduateId);
  const candidate = versions.data?.find(
    (version) => version.version === improvement?.candidateVersion,
  );
  const active = versions.data?.find((version) => version.active);
  const lessons = improves.corrections.flatMap((id) => {
    const found = corrections.data?.find((correction) => correction.id === id);
    return found ? [found] : [];
  });
  const name = agent?.name ?? detail.job.name;
  const watch = () => navigate(paths.train(runId));
  const backToTeaching = () => {
    navigate(paths.home());
    showSettings(improves.graduateId, 'teaching');
  };

  if (!improvement) {
    return (
      <Page title={name}>
        {improvements.status === 'error' ? (
          <ProblemState
            error={improvements.error}
            title="Couldn't load what it changed"
            onRetry={improvements.reload}
            exit={{ label: 'Back to agents', onClick: () => navigate(paths.home()) }}
            className="min-h-[60vh]"
          />
        ) : (
          <ImprovementSkeleton />
        )}
      </Page>
    );
  }
  if (runningImprovement([improvement])) {
    return (
      <Page title={name}>
        <EmptyState
          icon={<TrendingUp aria-hidden />}
          title="Still improving"
          description="Its new version isn't made yet."
          actions={
            <Button variant="primary" size="md" onClick={watch}>
              Watch it
            </Button>
          }
          className="min-h-[56vh]"
        />
      </Page>
    );
  }

  const canPromote = improvement.promotion.allowed && candidate !== undefined && active;
  return (
    <Page
      title={name}
      footer={
        <div className="mx-auto flex max-w-[860px] flex-wrap justify-end gap-2">
          <Button onClick={watch}>See all rounds</Button>
          {canPromote ? (
            <Button variant="primary" onClick={() => setPromoting(true)}>
              <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
              Use version {candidate.version}
            </Button>
          ) : (
            <Button variant="primary" onClick={backToTeaching}>
              Back to Teaching
            </Button>
          )}
        </div>
      }
    >
      <ImprovementView
        improvement={improvement}
        job={detail.job}
        run={detail.run}
        lessons={lessons}
        name={name}
        mentor={modelNames(detail.job).mentor}
      />
      {promoting && agent && candidate && active && (
        <MoveDialog
          agent={agent}
          version={candidate}
          kind="promote"
          active={active}
          onClose={() => {
            setPromoting(false);
            // Whether it may still be promoted is the improvement's to say, so read it again.
            void refreshTeaching(improves.graduateId);
          }}
        />
      )}
    </Page>
  );
}

function ImprovementSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading what it changed" className="flex flex-col gap-11">
      <div className="flex flex-col gap-3">
        <Skeleton shape="pill" className="h-7 w-24" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-[136px] w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-14">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    </div>
  );
}
