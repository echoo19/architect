import { useEffect, useState } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { Button, EmptyState, Skeleton } from '@architect/ui';
import { Bot } from 'lucide-react';
import { useGraduates, useJobs, useSettings } from '../api/hooks';
import { toError } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { SampleJobButton } from '../flow/describe/SampleJobButton';
import { ReadyMadeAgentButton } from '../import/ReadyMadeAgentButton';
import { mentorName, studentName } from '../lib/names';
import { chatPath, navigate, paths } from '../lib/router';
import { jobToPickUp, TRAINING_ROW_WORDS } from '../shell/training-rows';
import { WorkspaceHeader } from '../shell/WorkspaceShell';
import { latestChat } from '../workspace/store';

/** The workspace with no chat open: it opens the chat used last, or shows how to start. */
export function HomeScreen() {
  const graduates = useGraduates();
  return (
    <>
      <WorkspaceHeader />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto pb-14">
        {graduates.status === 'loading' && <HomeSkeleton />}
        {graduates.status === 'error' && (
          <ProblemState
            error={graduates.error}
            title="Couldn't load your agents"
            onRetry={graduates.reload}
            exit={{ label: 'New agent', onClick: () => navigate(paths.newAgent()) }}
          />
        )}
        {graduates.status === 'success' &&
          (graduates.data.length > 0 ? (
            <OpenLatestChat graduates={graduates.data} />
          ) : (
            <NoAgentsYet />
          ))}
      </div>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading agents" className="flex flex-col items-center gap-5">
      <Skeleton className="size-12 rounded-control" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3.5 w-72" />
    </div>
  );
}

function OpenLatestChat({ graduates }: { graduates: GraduateSummary[] }) {
  const settings = useSettings();
  const onboarded = settings.data?.onboarded === true;
  const [failure, setFailure] = useState<Error | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    // Until setup is finished, the app sends this screen to the welcome flow instead.
    if (!onboarded) return;
    let current = true;
    latestChat(graduates.map((graduate) => graduate.id)).then(
      (chat) => {
        if (current) navigate(chatPath(chat), { replace: true });
      },
      (error: unknown) => {
        if (current) setFailure(toError(error));
      },
    );
    return () => {
      current = false;
    };
  }, [graduates, onboarded, tries]);

  const problem = failure ?? (settings.status === 'error' ? settings.error : null);
  if (problem) {
    return (
      <ProblemState
        error={problem}
        title="Couldn't open your chats"
        onRetry={() => {
          setFailure(null);
          settings.reload();
          setTries((count) => count + 1);
        }}
      />
    );
  }
  return <HomeSkeleton />;
}

function NoAgentsYet() {
  const settings = useSettings();
  // A job drafted or training is picked up from here, so home never reads as empty while it is.
  const jobs = useJobs();
  const pickUp = jobs.status === 'success' ? jobToPickUp(jobs.data) : null;
  const pitch =
    settings.status === 'success'
      ? `Describe a job, and ${mentorName(settings.data.defaultMentor)} teaches ${studentName(
          settings.data.defaultStudent,
        )} to do it.`
      : 'Describe a job and Architect trains an agent to do it.';

  if (pickUp) {
    return (
      <EmptyState
        icon={<Bot aria-hidden />}
        title={pickUp.job.name}
        description={
          pickUp.kind === 'drafted'
            ? 'Drafted, not trained yet.'
            : `${TRAINING_ROW_WORDS[pickUp.kind]}.`
        }
        actions={
          <>
            <Button variant="primary" size="md" onClick={() => navigate(pickUp.path)}>
              {pickUp.kind === 'drafted' ? 'Review the job' : `Open ${pickUp.job.name}`}
            </Button>
            <Button size="md" onClick={() => navigate(paths.newAgent())}>
              New agent
            </Button>
          </>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<Bot aria-hidden />}
      title="No agents yet"
      description={pitch}
      actions={
        <>
          <Button variant="primary" size="md" onClick={() => navigate(paths.newAgent())}>
            New agent
          </Button>
          <SampleJobButton size="md" />
          <ReadyMadeAgentButton size="md" />
        </>
      }
    />
  );
}
