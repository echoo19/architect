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
  NavItem,
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
import { EDITIONS, placesOf, useEdition } from './edition';
import { placeOf } from './places';
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

/** The selected fill slides between the rows that share this name (`NavItem`). */
const INDICATOR = 'sidebar-current';

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
  const edition = useEdition();
  // The personal edition has its agents only; the Lab leads with its places.
  const places = edition ? placesOf(edition) : [];

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-4 border-r border-line bg-ground px-3 pb-3.5">
      {/*
        The top strip drags the window. It is the native title bar's 56px, so the wordmark sits on
        the line of the traffic lights on macOS and of a chat's title.
      */}
      <div
        className={cn(
          'app-drag -mx-3 flex h-14 shrink-0 items-center gap-2 px-5',
          isMac() && 'pl-[78px]',
        )}
      >
        <LogoMark size={20} />
        <span className="text-body font-semibold">{EDITIONS[edition ?? 'personal'].name}</span>
      </div>

      {places.length > 0 && (
        <nav aria-label="Places" className="flex flex-col gap-0.5">
          {places.map(({ id, label, Icon, path }) => (
            <NavItem
              key={id}
              icon={<Icon size={16} strokeWidth={1.8} aria-hidden />}
              current={place === id}
              indicator={INDICATOR}
              onClick={() => navigate(path)}
            >
              {label}
            </NavItem>
          ))}
        </nav>
      )}

      <nav
        aria-label="Agents"
        className={cn(
          'flex min-h-0 flex-col gap-4',
          places.length > 0 && 'border-t border-line pt-4',
        )}
      >
        <div className="flex items-center gap-0.5">
          <NavItem
            icon={<Plus size={16} strokeWidth={1.8} aria-hidden />}
            current={route.name === 'new'}
            onClick={() => navigate(paths.newAgent())}
            className="flex-1"
          >
            New agent
          </NavItem>
          <AgentMenu />
        </div>

        <div className="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1 scroll-quiet">
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

      <NavItem
        icon={<Settings size={16} strokeWidth={1.8} aria-hidden />}
        onClick={() => openSettings()}
      >
        Settings
      </NavItem>
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
        <div className="flex flex-col gap-2.5 py-1.5 pl-11" aria-busy="true">
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
          className="py-1.5 pl-11 pr-2.5"
        />
      )}
      {list?.map((chat, index) => {
        const current = route.name === 'chat' && route.chatId === chat.id;
        return (
          <StaggerItem key={chat.id} index={index}>
            <NavItem
              nested
              current={current}
              onClick={() => navigate(paths.chat(graduate.id, chat.id))}
              end={
                // A chat waiting for an answer isn't working; the open one says so in the thread.
                chat.waiting ? (
                  current ? undefined : (
                    'Approve'
                  )
                ) : chat.running ? (
                  <Spinner tone="student" label="Working" />
                ) : undefined
              }
            >
              {chat.title}
            </NavItem>
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
    <NavItem
      icon={<RowIcon kind={row.kind} />}
      current={current}
      onClick={() => navigate(row.path)}
      end={<span className={ROW_TONE[row.kind] ?? 'text-fg'}>{TRAINING_ROW_WORDS[row.kind]}</span>}
    >
      {row.jobName}
    </NavItem>
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
