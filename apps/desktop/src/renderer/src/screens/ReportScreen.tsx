import { useState } from 'react';
import type { ReportCard } from '@architect/shared';
import { Button, ErrorState, Skeleton } from '@architect/ui';
import { ArrowRight } from 'lucide-react';
import { api, flowApi } from '../api/client';
import { graduateKeys, graduatesApi } from '../api/graduates';
import {
  createChat,
  queryKeys,
  useGraduates,
  useJob,
  useReport,
  useRunDetail,
  useSettings,
} from '../api/hooks';
import { fetchQuery, useQuery } from '../api/query';
import { useComparison } from '../flow/report/ComparisonTable';
import {
  useBareReport,
  useCapabilityEvidence,
  useComparisonReport,
  useReportEvidence,
} from '../flow/report/evidence';
import { ReportView } from '../flow/report/ReportView';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';

/** Step four: how the graduate did on the locked test, and taking it into the workspace. */
export function ReportScreen({ runId }: { runId: string }) {
  const report = useReport(runId);
  const [accepting, setAccepting] = useState(false);

  const accept = async (card: ReportCard) => {
    setAccepting(true);
    const opened = await attempt(`Couldn't add ${card.name} to your workspace`, async () => {
      const graduate = await flowApi.acceptGraduate(runId);
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
      step="Report"
      footer={
        report.status === 'success' && (
          <div className="mx-auto flex max-w-[860px] flex-wrap justify-end gap-2">
            <Button onClick={() => navigate(paths.train(runId))}>See all rounds</Button>
            <Button variant="primary" loading={accepting} onClick={() => void accept(report.data)}>
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
            title="Couldn't load the report card"
            message={report.error.message}
            onRetry={report.reload}
            secondaryAction={
              <Button size="md" onClick={() => navigate(paths.train(runId))}>
                Back to training
              </Button>
            }
            className="min-h-[60vh]"
          />
        )}
        {report.status === 'success' && <LoadedReport report={report.data} />}
      </div>
    </FlowShell>
  );
}

function LoadedReport({ report }: { report: ReportCard }) {
  const job = useJob(report.jobId);
  const graduates = useGraduates();
  const settings = useSettings();
  const run = useRunDetail(report.runId);
  const comparison = useComparison(report, settings.data?.comparisonMode === true);
  const blankStart = job.data?.startingHarness.kind === 'blank';
  const capabilities = useCapabilityEvidence(report);
  const evidence = useReportEvidence(report);
  const comparisonReport = useComparisonReport(report);
  const bare = useBareReport(report, blankStart);
  const graduate = graduates.data?.find((item) => item.manifest.runId === report.runId);
  // Install checks belong to the agent on this computer, once the run has made one.
  const installation = useQuery(graduateKeys.installation(graduate?.id ?? 'none'), () =>
    graduate ? graduatesApi.installation(graduate.id) : Promise.resolve(null),
  );
  return (
    <ReportView
      report={report}
      job={job.status === 'success' ? job.data : null}
      graduate={graduate}
      comparison={comparison}
      capabilities={capabilities}
      evidence={evidence}
      bare={bare.data ?? null}
      run={run.data?.run ?? null}
      installation={installation.data ?? null}
      comparisonReport={comparisonReport}
    />
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the report card" className="flex flex-col gap-11">
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
