import { useState } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { AgentAvatar, Button, EmptyState, ErrorState, Skeleton } from '@architect/ui';
import { Bot, Plus } from 'lucide-react';
import { architect } from '../api/client';
import { createChat, useGraduates, useSettings } from '../api/hooks';
import { mentorName, studentName } from '../lib/names';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { WorkspaceHeader } from '../shell/WorkspaceShell';

/** The workspace with no chat open: the agents to pick from, or how to make the first one. */
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
          (graduates.data[0] ? <PickAChat graduate={graduates.data[0]} /> : <NoAgentsYet />)}
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

function NoAgentsYet() {
  const settings = useSettings();
  const [creating, setCreating] = useState(false);
  const pitch =
    settings.status === 'success'
      ? `Describe a job. ${mentorName(settings.data.defaultMentor)} teaches ${studentName(
          settings.data.defaultStudent,
        )} to do it, then the agent runs on ${deviceInSentence(currentPlatform())}.`
      : `Describe a job and Architect trains an agent that runs on ${deviceInSentence(
          currentPlatform(),
        )}.`;

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

function PickAChat({ graduate }: { graduate: GraduateSummary }) {
  const [creating, setCreating] = useState(false);
  const start = async () => {
    setCreating(true);
    const chat = await attempt(`Couldn't start a chat with ${graduate.name}`, () =>
      createChat(graduate.id),
    );
    setCreating(false);
    if (chat) navigate(paths.chat(graduate.id, chat.id));
  };
  return (
    <EmptyState
      icon={<AgentAvatar name={graduate.name} size="lg" />}
      iconTile={false}
      title="Pick up where you left off"
      description="Open a chat from the sidebar, or start a new one."
      actions={
        <Button variant="primary" size="md" loading={creating} onClick={start}>
          New chat with {graduate.name}
        </Button>
      }
    />
  );
}
