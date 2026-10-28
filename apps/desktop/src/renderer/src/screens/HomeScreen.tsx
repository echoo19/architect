import { useEffect, useState } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { Button, EmptyState, ErrorState, Skeleton } from '@architect/ui';
import { Bot, Plus } from 'lucide-react';
import { architect } from '../api/client';
import { useGraduates, useSettings } from '../api/hooks';
import { toError } from '../api/query';
import { mentorIntro, mentorName, studentIntro, studentName } from '../lib/names';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
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
          <ErrorState
            title="Couldn't load your agents"
            message={graduates.error.message}
            onRetry={graduates.reload}
            secondaryAction={
              <Button size="md" onClick={() => navigate(paths.newAgent())}>
                <Plus size={16} aria-hidden />
                New agent
              </Button>
            }
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
      <Skeleton className="size-12 rounded-xl" />
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
        if (current) navigate(paths.chat(chat.graduateId, chat.id), { replace: true });
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
      <ErrorState
        title="Couldn't open your chats"
        message={problem.message}
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
  const [creating, setCreating] = useState(false);
  const device = deviceInSentence(currentPlatform());
  const pitch =
    settings.status === 'success'
      ? `Describe a job, and ${mentorIntro(mentorName(settings.data.defaultMentor))}, teaches ${studentIntro(
          studentName(settings.data.defaultStudent),
        )}, to do it. The agent runs on ${device}.`
      : `Describe a job and Architect trains an agent that runs on ${device}.`;

  const trySample = async () => {
    setCreating(true);
    const job = await attempt("Couldn't create the sample job", () =>
      architect().jobs.createSample(),
    );
    setCreating(false);
    if (job) navigate(paths.define(job.id));
  };

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
          <Button size="md" loading={creating} onClick={trySample}>
            Try the sample job
          </Button>
        </>
      }
    />
  );
}
