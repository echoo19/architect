import { useState } from 'react';
import type { ReportCard } from '@architect/shared';
import { Button, Skeleton } from '@architect/ui';
import { ArrowRight, Boxes, Library } from 'lucide-react';
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
import { useRegistry, versionOfRun } from '../models/load';
import { useEdition } from '../shell/edition';
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
      field={report.data?.jobId}
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
      <div className="mx-auto box-content flex max-w-[1120px] flex-col px-10 pb-12 pt-12">
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
  const edition = useEdition();
  return (
    <div className="mx-auto flex max-w-[1120px] flex-wrap justify-end gap-2">
      {edition === 'lab' && <LabLinks report={report} />}
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

/**
 * Where the results lead in the Lab: the field the run taught, and the version it made in
 * Models with its panel open, once that version is on this computer.
 */
function LabLinks({ report }: { report: ReportCard }) {
  const registry = useRegistry();
  const version = registry.data ? versionOfRun(registry.data, report.runId) : undefined;
  return (
    <div className="mr-auto flex flex-wrap gap-2">
      <Button variant="ghost" onClick={() => navigate(paths.field(report.jobId))}>
        <Library size={16} strokeWidth={1.8} aria-hidden />
        Open field
      </Button>
      {version && (
        <Button variant="ghost" onClick={() => navigate(paths.models(version.key))}>
          <Boxes size={16} strokeWidth={1.8} aria-hidden />
          Open in Models
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
    <div aria-busy="true" aria-label="Loading the results" className="flex flex-col gap-12">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-4 w-[420px]" />
      </div>
      <Skeleton className="h-[136px] w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  );
}
