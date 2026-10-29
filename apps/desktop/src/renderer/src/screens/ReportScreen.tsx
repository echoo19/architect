import { useState } from 'react';
import type { ReportCard } from '@architect/shared';
import { Button, Skeleton } from '@architect/ui';
import { ArrowRight } from 'lucide-react';
import { flowApi } from '../api/client';
import { graduateKeys, graduatesApi } from '../api/graduates';
import {
  createChat,
  useGraduates,
  useJob,
  useReport,
  useRunDetail,
  useSettings,
} from '../api/hooks';
import { useQuery } from '../api/query';
import { refreshRunLists } from '../api/updates';
import { ProblemState } from '../components/ProblemState';
import { useComparison } from '../flow/report/ComparisonTable';
import {
  useBareReport,
  useCapabilityEvidence,
  useComparisonReport,
  useReportEvidence,
} from '../flow/report/evidence';
import { ReportView } from '../flow/report/ReportView';
import { useLocalCard } from '../flow/report/use-retest';
import { reportVerdict } from '../flow/report/verdict';
import { shortModelName } from '../lib/names';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';

/** Step four: how the graduate did on the locked test, and taking it into the workspace. */
export function ReportScreen({ runId }: { runId: string }) {
  const report = useReport(runId);
  const [accepting, setAccepting] = useState(false);

  const accept = async (card: ReportCard) => {
    setAccepting(true);
    const opened = await attempt(`Couldn't add ${card.name} to your workspace`, async () => {
      const graduate = await flowApi.acceptGraduate(runId);
      // Its row stops reading "Results ready" now that the agent is the person's.
      await refreshRunLists();
      const chat = await createChat(graduate.id);
      return { graduateId: graduate.id, chatId: chat.id };
    });
    setAccepting(false);
    if (opened) navigate(paths.chat(opened.graduateId, opened.chatId));
  };

  return (
    <FlowShell
      title={report.data?.name ?? 'Results'}
      step="Results"
      footer={
        report.status === 'success' && (
          <ReportFooter
            report={report.data}
            accepting={accepting}
            onAccept={() => void accept(report.data)}
          />
        )
      }
    >
      <div className="mx-auto box-content flex max-w-[860px] flex-col gap-11 px-8 pb-8 pt-14">
        {report.status === 'loading' && <ReportSkeleton />}
        {report.status === 'error' && (
          <ProblemState
            error={report.error}
            title="Couldn't load the results"
            onRetry={report.reload}
            exit={{ label: 'Back to agents', onClick: () => navigate(paths.home()) }}
            className="min-h-[60vh]"
          />
        )}
        {report.status === 'success' && <LoadedReport report={report.data} />}
      </div>
    </FlowShell>
  );
}

/**
 * The agent a run made, once it exists here, with this computer's checks of it and the verdict
 * the results give from them and the final test together. The footer and the page read the same
 * cached queries, so they never disagree.
 */
function useReportAgent(report: ReportCard) {
  const graduates = useGraduates();
  const graduate = graduates.data?.find((item) => item.manifest.runId === report.runId);
  // Install checks belong to the agent on this computer, once the run has made one.
  const installation = useQuery(graduateKeys.installation(graduate?.id ?? 'none'), () =>
    graduate ? graduatesApi.installation(graduate.id) : Promise.resolve(null),
  );
  // A run whose own test ran online is ready only once it has been tested here.
  const here = useLocalCard(report).data ?? null;
  const verdict = reportVerdict(
    report,
    installation.data ?? null,
    {
      model: shortModelName(report.student.label),
      baseBytes: graduate?.manifest.student.sizeBytes,
    },
    here,
  );
  return { graduate, installation: installation.data ?? null, verdict, here };
}

/**
 * What to do next: use the agent when it can be used, else the one thing that puts it right,
 * which is in its settings.
 */
function ReportFooter({
  report,
  accepting,
  onAccept,
}: {
  report: ReportCard;
  accepting: boolean;
  onAccept: () => void;
}) {
  const { graduate, verdict } = useReportAgent(report);
  const showSettings = useAgentSettingsUi((state) => state.show);
  return (
    <div className="mx-auto flex max-w-[860px] flex-wrap justify-end gap-2">
      <Button onClick={() => navigate(paths.train(report.runId))}>See all rounds</Button>
      {verdict.usable || !graduate ? (
        <Button variant="primary" loading={accepting} onClick={onAccept}>
          Start using {report.name}
          <ArrowRight size={16} strokeWidth={2} aria-hidden />
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => {
            navigate(paths.home());
            showSettings(graduate.id, 'general');
          }}
        >
          {verdict.state === 'blocked' ? "See what's wrong" : 'Finish setting up'}
          <ArrowRight size={16} strokeWidth={2} aria-hidden />
        </Button>
      )}
    </div>
  );
}

function LoadedReport({ report }: { report: ReportCard }) {
  const job = useJob(report.jobId);
  const settings = useSettings();
  const run = useRunDetail(report.runId);
  const comparison = useComparison(report, settings.data?.comparisonMode === true);
  const blankStart = job.data?.startingHarness.kind === 'blank';
  const capabilities = useCapabilityEvidence(report);
  const evidence = useReportEvidence(report);
  const comparisonReport = useComparisonReport(report);
  const bare = useBareReport(report, blankStart);
  const { graduate, installation, verdict, here } = useReportAgent(report);
  return (
    <ReportView
      report={report}
      verdict={verdict}
      job={job.status === 'success' ? job.data : null}
      graduate={graduate}
      comparison={comparison}
      capabilities={capabilities}
      evidence={evidence}
      bare={bare.data ?? null}
      run={run.data?.run ?? null}
      installation={installation}
      comparisonReport={comparisonReport}
      here={here}
    />
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the results" className="flex flex-col gap-11">
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
