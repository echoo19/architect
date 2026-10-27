import { useState } from 'react';
import type { GraduateSummary, JobSummary } from '@architect/shared';
import {
  AgentAvatar,
  cn,
  ErrorState,
  IconButton,
  LogoMark,
  Skeleton,
  Spinner,
  StatusDot,
  Tooltip,
} from '@architect/ui';
import { Ellipsis, Pause, Plus, Settings } from 'lucide-react';
import { useGraduates, useJobs } from '../api/hooks';
import { formatPercent } from '../lib/format';
import { attempt } from '../lib/notify';
import { isMac } from '../lib/platform';
import { navigate, paths, type Route } from '../lib/router';
import { useUi } from '../state/ui';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { createChat, useAgentChats } from '../workspace/store';

const navRow =
  'flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-fg-secondary ' +
  'transition-colors duration-150 hover:bg-hover hover:text-fg';

const ACTIVE_RUN = new Set(['queued', 'running', 'paused', 'stopping', 'testing']);

export function Sidebar({ route }: { route: Route }) {
  const graduates = useGraduates();
  const jobs = useJobs();
  const openSettings = useUi((state) => state.openSettings);

  return (
    <nav
      aria-label="Agents"
      className="flex h-full w-60 shrink-0 flex-col gap-5 border-r border-line bg-sidebar px-3 pb-3.5"
    >
      {/* The top strip drags the window; on macOS the traffic lights sit at its left. */}
      <div
        className={cn(
          'app-drag -mx-3 flex h-12 shrink-0 items-center gap-2.5 px-5.5 pt-5',
          isMac() && 'pl-[78px]',
        )}
      >
        <LogoMark size={20} />
        <span className="text-md font-semibold tracking-tight">Architect</span>
      </div>

      <button
        type="button"
        onClick={() => navigate(paths.newAgent())}
        aria-current={route.name === 'new' ? 'page' : undefined}
        className={cn(navRow, route.name === 'new' && 'bg-hover text-fg')}
      >
        <Plus size={16} strokeWidth={1.8} aria-hidden />
        New agent
      </button>

      <div className="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
        {graduates.data ? (
          <>
            <AgentList graduates={graduates.data} route={route} />
            {jobs.data ? (
              <TrainingList jobs={jobs.data} route={route} />
            ) : (
              jobs.status === 'error' && (
                <ErrorState
                  layout="inline"
                  title="Couldn't load training"
                  message={jobs.error.message}
                  onRetry={jobs.reload}
                  className="px-2.5"
                />
              )
            )}
          </>
        ) : graduates.status === 'error' ? (
          <ErrorState
            layout="inline"
            title="Couldn't load your agents"
            message={graduates.error.message}
            onRetry={() => {
              graduates.reload();
              jobs.reload();
            }}
            className="px-2.5"
          />
        ) : (
          <AgentListSkeleton />
        )}
      </div>

      <div className="flex-1" />

      <button type="button" onClick={() => openSettings()} className={navRow}>
        <Settings size={17} strokeWidth={1.6} aria-hidden />
        Settings
      </button>
    </nav>
  );
}

function AgentListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading agents" className="flex flex-col gap-3 px-2.5">
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col gap-2.5">
          <div className="flex h-9 items-center gap-2.5">
            <Skeleton className="size-[18px] rounded-[5px]" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="ml-7 h-3 w-32" />
          <Skeleton className="ml-7 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

function AgentList({ graduates, route }: { graduates: GraduateSummary[]; route: Route }) {
  if (graduates.length === 0) {
    return <p className="m-0 px-2.5 text-sm text-fg-muted">No agents yet</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {graduates.map((graduate) => (
        <AgentGroup key={graduate.id} graduate={graduate} route={route} />
      ))}
    </div>
  );
}

function AgentGroup({ graduate, route }: { graduate: GraduateSummary; route: Route }) {
  const chats = useAgentChats(graduate.id);
  const showSettings = useAgentSettingsUi((state) => state.show);
  const [creating, setCreating] = useState(false);
  const list = chats.entry.data;

  const startChat = async () => {
    setCreating(true);
    const chat = await attempt(`Couldn't start a chat with ${graduate.name}`, () =>
      createChat(graduate.id),
    );
    setCreating(false);
    if (chat) navigate(paths.chat(graduate.id, chat.id));
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex h-9 items-center gap-2.5 pl-2.5 pr-0.5">
        <AgentAvatar name={graduate.name} />
        <span className="min-w-0 flex-1 truncate font-medium">{graduate.name}</span>
        <Tooltip content="New chat" side="right">
          <IconButton
            label={`New chat with ${graduate.name}`}
            size="xs"
            disabled={creating}
            onClick={() => void startChat()}
          >
            <Plus size={14} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content="Agent settings" side="right">
          <IconButton
            label={`${graduate.name} settings`}
            size="xs"
            onClick={() => showSettings(graduate.id)}
          >
            <Ellipsis size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      {!list && chats.entry.status === 'loading' && (
        <div className="flex flex-col gap-2.5 py-1.5 pl-[38px]" aria-busy="true">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      )}
      {!list && chats.entry.status === 'error' && (
        <ErrorState
          layout="inline"
          title="Couldn't load chats"
          message={chats.entry.error}
          onRetry={chats.reload}
          className="py-1.5 pl-[38px] pr-2.5"
        />
      )}
      {list?.map((chat) => {
        const current = route.name === 'chat' && route.chatId === chat.id;
        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => navigate(paths.chat(graduate.id, chat.id))}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex h-[34px] w-full shrink-0 items-center justify-between gap-2 rounded-md pl-[38px] pr-2.5 text-left',
              'transition-colors duration-150 hover:bg-row-hover',
              current
                ? 'bg-hover text-fg hover:bg-hover'
                : chat.running || chat.waiting
                  ? 'text-fg-soft'
                  : 'text-fg-secondary',
            )}
          >
            <span className="truncate">{chat.title}</span>
            {/* A chat waiting for an answer isn't working; the open one says so in the thread. */}
            {chat.waiting ? (
              !current && <StatusDot tone="student" label="Needs you" />
            ) : chat.running ? (
              <Spinner tone="student" label="Working" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function TrainingList({ jobs, route }: { jobs: JobSummary[]; route: Route }) {
  const training = jobs.filter((job) => job.latestRun && ACTIVE_RUN.has(job.latestRun.status));
  if (training.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 border-t border-line pt-4">
      {training.map((job) => {
        const run = job.latestRun!;
        const current = route.name === 'train' && route.runId === run.id;
        return (
          <button
            key={job.id}
            type="button"
            onClick={() => navigate(paths.train(run.id))}
            aria-current={current ? 'page' : undefined}
            className={cn(navRow, current && 'bg-hover text-fg')}
          >
            {run.status === 'paused' ? (
              <Pause size={16} className="text-mentor" aria-label="Paused" />
            ) : (
              <Spinner tone="mentor" size={16} label="Training" />
            )}
            <span className="flex-1 truncate">{job.name}</span>
            {run.devCurrent && (
              <span className="text-xs text-fg-muted">
                {formatPercent(run.devCurrent)}
                <span className="sr-only"> of check tasks right so far</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
