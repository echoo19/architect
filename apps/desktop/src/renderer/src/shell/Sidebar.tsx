import { useEffect, useState } from 'react';
import type { GraduateSummary, JobSummary } from '@architect/shared';
import {
  AgentAvatar,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  LogoMark,
  Skeleton,
  Spinner,
  StaggerItem,
  Tooltip,
} from '@architect/ui';
import {
  CircleAlert,
  CircleCheck,
  Cloud,
  Ellipsis,
  MessageCircleQuestion,
  PackageOpen,
  Pause,
  Plus,
  Settings,
  Square,
} from 'lucide-react';
import { PLACES, placeOf } from './places';
import { api } from '../api/client';
import { queryKeys, useGraduates, useJobs } from '../api/hooks';
import { fetchQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { chooseFromHub, chooseImport } from '../import/session';
import { attempt } from '../lib/notify';
import { isMac } from '../lib/platform';
import { navigate, paths, type Route } from '../lib/router';
import { useUi } from '../state/ui';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { createChat, useAgentChats } from '../workspace/store';
import {
  TRAINING_ROW_WORDS,
  trainingRows,
  type TrainingRow,
  type TrainingRowKind,
} from './training-rows';

const navRow =
  'flex h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-fg ' +
  'transition-colors duration-150 hover:bg-hover';

/** The selected row: a clear surface of its own, one step above hover. */
const selectedRow = 'bg-selected hover:bg-selected';

/**
 * The list of runs is read again whenever the sidebar appears, since the screens without it, such
 * as training and results, are where runs start and end. The app keeps it current in between
 * (`useEngineUpdates`).
 */
function useTrainingRefresh(): void {
  useEffect(() => {
    void fetchQuery(queryKeys.jobs, api.jobs);
  }, []);
}

export function Sidebar({ route }: { route: Route }) {
  const graduates = useGraduates();
  const jobs = useJobs();
  const openSettings = useUi((state) => state.openSettings);
  useTrainingRefresh();

  const place = placeOf(route);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-4 border-r border-line bg-ground px-3 pb-3.5">
      {/* The top strip drags the window; on macOS the traffic lights sit at its left. */}
      <div
        className={cn(
          'app-drag -mx-3 flex h-12 shrink-0 items-center gap-2.5 px-5.5 pt-5',
          isMac() && 'pl-[78px]',
        )}
      >
        <LogoMark size={20} />
        <span className="text-body font-semibold">Architect</span>
      </div>

      <nav aria-label="Places" className="flex flex-col gap-0.5">
        {PLACES.map(({ id, label, Icon, path }) => (
          <button
            key={id}
            type="button"
            onClick={() => navigate(path)}
            aria-current={place === id ? 'page' : undefined}
            className={cn(navRow, place === id && selectedRow)}
          >
            <Icon size={17} strokeWidth={1.6} aria-hidden />
            {label}
          </button>
        ))}
      </nav>

      <nav aria-label="Agents" className="flex min-h-0 flex-col gap-4 border-t border-line pt-4">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => navigate(paths.newAgent())}
            aria-current={route.name === 'new' ? 'page' : undefined}
            className={cn(navRow, 'min-w-0 flex-1', route.name === 'new' && selectedRow)}
          >
            <Plus size={16} strokeWidth={1.8} aria-hidden />
            New agent
          </button>
          <AgentMenu />
        </div>

        <div className="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1">
          {graduates.data ? (
            <>
              <AgentList graduates={graduates.data} route={route} />
              {jobs.data ? (
                <TrainingList jobs={jobs.data} route={route} />
              ) : (
                jobs.status === 'error' && (
                  <ProblemState
                    layout="inline"
                    error={jobs.error}
                    title="Couldn't load training"
                    onRetry={jobs.reload}
                    className="px-2.5"
                  />
                )
              )}
            </>
          ) : graduates.status === 'error' ? (
            <ProblemState
              layout="inline"
              error={graduates.error}
              title="Couldn't load your agents"
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
      </nav>

      <div className="flex-1" />

      <button type="button" onClick={() => openSettings()} className={navRow}>
        <Settings size={17} strokeWidth={1.6} aria-hidden />
        Settings
      </button>
    </aside>
  );
}

/** More ways to add an agent: importing one someone exported. */
function AgentMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Agent menu" size="md">
          <Ellipsis size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom">
        <DropdownMenuItem
          icon={<PackageOpen aria-hidden />}
          onSelect={() => void attempt("Couldn't open that package", () => chooseImport())}
        >
          Import agent
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Cloud aria-hidden />} onSelect={chooseFromHub}>
          Install from Hugging Face
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading agents" className="flex flex-col gap-3 px-2.5">
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col gap-2.5">
          <div className="flex h-9 items-center gap-2.5">
            <Skeleton className="size-6 rounded-mark" />
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
  // With none, the screen beside it says so, and New agent above is the way to make one.
  if (graduates.length === 0) return null;
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
    <div className="group/agent flex flex-col gap-0.5">
      <div className="flex h-9 items-center gap-2.5 pl-2.5 pr-0.5">
        <AgentAvatar name={graduate.name} />
        <span className="min-w-0 flex-1 truncate font-medium">{graduate.name}</span>
        {/* Out of the way until the agent is pointed at or reached with the keyboard. */}
        <div className="flex items-center opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/agent:opacity-100">
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
      </div>
      {!list && chats.entry.status === 'loading' && (
        <div className="flex flex-col gap-2.5 py-1.5 pl-[38px]" aria-busy="true">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      )}
      {!list && chats.entry.status === 'error' && (
        <ProblemState
          layout="inline"
          error={chats.entry.error}
          title="Couldn't load chats"
          onRetry={chats.reload}
          className="py-1.5 pl-[38px] pr-2.5"
        />
      )}
      {list?.map((chat, index) => {
        const current = route.name === 'chat' && route.chatId === chat.id;
        return (
          <StaggerItem key={chat.id} index={index}>
            <button
              type="button"
              onClick={() => navigate(paths.chat(graduate.id, chat.id))}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-[34px] w-full shrink-0 items-center justify-between gap-2 rounded-control pl-[38px] pr-2.5 text-left',
                'transition-colors duration-150 hover:bg-hover',
                current && selectedRow,
              )}
            >
              <span className="truncate">{chat.title}</span>
              {/* A chat waiting for an answer isn't working; the open one says so in the thread. */}
              {chat.waiting ? (
                !current && <span className="shrink-0 text-small">Approve</span>
              ) : chat.running ? (
                <Spinner tone="student" label="Working" />
              ) : null}
            </button>
          </StaggerItem>
        );
      })}
    </div>
  );
}

/** What each kind of row leads with: a spinner while it trains, an icon of its own otherwise. */
function RowIcon({ kind }: { kind: TrainingRowKind }) {
  switch (kind) {
    case 'training':
      return <Spinner tone="mentor" size={16} label="Training" />;
    case 'paused':
      return <Pause size={16} className="text-mentor" aria-label="Paused" />;
    case 'question':
      return (
        <MessageCircleQuestion size={16} strokeWidth={1.8} className="text-mentor" aria-hidden />
      );
    case 'results':
      return <CircleCheck size={16} strokeWidth={1.8} className="text-student" aria-hidden />;
    case 'stopped':
      return <Square size={16} strokeWidth={1.8} className="text-fg" aria-hidden />;
    case 'failed':
      return <CircleAlert size={16} strokeWidth={1.8} className="text-danger" aria-hidden />;
  }
}

const ROW_TONE: Partial<Record<TrainingRowKind, string>> = {
  results: 'text-student',
  failed: 'text-danger',
};

function TrainingRowButton({ row, route }: { row: TrainingRow; route: Route }) {
  const current = (route.name === 'train' || route.name === 'report') && route.runId === row.runId;
  return (
    <button
      type="button"
      onClick={() => navigate(row.path)}
      aria-current={current ? 'page' : undefined}
      className={cn(navRow, current && selectedRow)}
    >
      <RowIcon kind={row.kind} />
      <span className="flex-1 truncate">{row.jobName}</span>
      <span className={cn('shrink-0 text-small', ROW_TONE[row.kind] ?? 'text-fg')}>
        {TRAINING_ROW_WORDS[row.kind]}
      </span>
    </button>
  );
}

/**
 * The runs a person can open from here: each job's newest run of its agent while it trains, when
 * its results are ready and nobody has taken the agent yet, and when it stopped or failed, so a
 * run that ends while they are elsewhere is never lost.
 */
function TrainingList({ jobs, route }: { jobs: JobSummary[]; route: Route }) {
  const rows = trainingRows(jobs);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 border-t border-line pt-4">
      {rows.map((row) => (
        <TrainingRowButton key={row.jobId} row={row} route={route} />
      ))}
    </div>
  );
}
