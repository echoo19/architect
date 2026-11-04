import { useEffect, useRef, useState } from 'react';
import type { Edition, GraduateSummary, JobSummary, Team, WorkspaceChat } from '@architect/shared';
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
  RowIcon,
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
  FilePen,
  MessageCircleQuestion,
  PackageOpen,
  Pause,
  Plus,
  Settings,
  ShieldCheck,
  Square,
  Users,
} from 'lucide-react';
import { EDITIONS, placesOf, useEdition } from './edition';
import { ExperimentalBadge } from './ExperimentalBadge';
import { placeOf } from './places';
import { api } from '../api/client';
import { queryKeys, useGraduates, useJobs } from '../api/hooks';
import { fetchQuery } from '../api/query';
import { useTeams } from '../api/teams';
import { ProblemState } from '../components/ProblemState';
import { chooseFromHub, chooseImport } from '../import/session';
import { attempt } from '../lib/notify';
import { isMac } from '../lib/platform';
import { chatPath, navigate, paths, type Route } from '../lib/router';
import { useUi } from '../state/ui';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import {
  createChat,
  createTeamChat,
  useAgentChats,
  useTeamChats,
  type ListState,
} from '../workspace/store';
import {
  draftedJobs,
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
  const openSettings = useUi((state) => state.openSettings);

  const edition = useEdition();
  // Architect WSP's one place is its home.
  const place = edition === 'wsp' && route.name === 'home' ? 'wsp' : placeOf(route);
  // The personal edition has its agents only; the Lab leads with its places; WSP has its own
  // experiments and no agents.
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
        {edition && <ExperimentalBadge edition={edition} />}
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

      {edition !== 'wsp' && <AgentsNav route={route} edition={edition} />}

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

/** The agents and their chats, the Lab's teams, and the runs under them. */
function AgentsNav({ route, edition }: { route: Route; edition: Edition | null }) {
  const graduates = useGraduates();
  const jobs = useJobs();
  useTrainingRefresh();
  const places = edition ? placesOf(edition) : [];
  return (
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

      {/* Padded so a focused row's ring isn't cut by the scrolling edge. */}
      <div className="-m-1 flex min-h-0 flex-col gap-5 overflow-y-auto p-1 scroll-quiet">
        {graduates.data ? (
          <>
            <AgentList graduates={graduates.data} route={route} />
            {edition === 'lab' && <TeamList route={route} />}
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

      {/*
          The runs keep their own place under the agents, whole, so one that ends while the person
          is elsewhere stays in view however many agents and teams there are; the agents scroll.
        */}
      {graduates.data && (
        <div className="flex shrink-0 flex-col">
          {jobs.data ? (
            <TrainingList jobs={jobs.data} route={route} drafts={edition !== 'lab'} />
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
        </div>
      )}
    </nav>
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
  // Agents that share a name are told apart by the version each answers with.
  const shared = new Set(
    graduates
      .map((graduate) => graduate.name)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );
  return (
    <div className="flex flex-col gap-3">
      {graduates.map((graduate) => (
        <AgentGroup
          key={graduate.id}
          graduate={graduate}
          route={route}
          showVersion={shared.has(graduate.name)}
        />
      ))}
    </div>
  );
}

/** Starts a chat and opens it, saying so if it couldn't. */
function useStartChat(name: string, create: () => Promise<WorkspaceChat>) {
  const [creating, setCreating] = useState(false);
  const start = async () => {
    setCreating(true);
    const chat = await attempt(`Couldn't start a chat with ${name}`, create);
    setCreating(false);
    if (chat) navigate(chatPath(chat));
  };
  return { creating, start: () => void start() };
}

/** "New chat", out of the way until the group is pointed at or reached with the keyboard. */
function NewChatButton({
  name,
  creating,
  onClick,
}: {
  name: string;
  creating: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content="New chat" side="right">
      <IconButton label={`New chat with ${name}`} size="xs" disabled={creating} onClick={onClick}>
        <Plus size={14} strokeWidth={1.8} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

/**
 * A group's actions sit over the end of its row, on the sidebar's ground, so the name has the
 * row's whole width until the group is pointed at or reached with the keyboard.
 */
const GROUP_ACTIONS =
  'absolute inset-y-0 right-0.5 flex items-center rounded-r-control bg-ground pl-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/agent:opacity-100';

/*
 * Over a row with a fill, the actions carry the same fill on the ground beneath them, so the
 * row reads as one piece: an inset shadow lays the translucent fill over the opaque ground.
 */
const ON_SELECTED = 'shadow-[inset_0_0_0_999px_var(--ui-selected)]';
const ON_HOVER = 'group-hover/row:shadow-[inset_0_0_0_999px_var(--ui-hover)]';
const ON_IN_CHAT = 'shadow-[inset_0_0_0_999px_var(--ui-hover)]';

function AgentGroup({
  graduate,
  route,
  showVersion,
}: {
  graduate: GraduateSummary;
  route: Route;
  /** Another agent has the same name: the row shows the version this one answers with. */
  showVersion: boolean;
}) {
  const chats = useAgentChats(graduate.id);
  const showSettings = useAgentSettingsUi((state) => state.show);
  const { creating, start } = useStartChat(graduate.name, () => createChat(graduate.id));
  const home = route.name === 'agent' && route.graduateId === graduate.id;
  // In one of its chats, the agent's row keeps a lighter fill, so the open chat has its place.
  const openChat = route.name === 'chat' && route.graduateId === graduate.id ? route.chatId : null;
  // The open agent, at its home or in one of its chats, scrolls into view with its chats, and
  // the open chat with it, however far down the list it is.
  const group = useRef<HTMLDivElement>(null);
  const loaded = chats.entry.data !== undefined;
  useEffect(() => {
    if (!(home || openChat) || !loaded) return;
    group.current?.scrollIntoView({ block: 'nearest' });
    group.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [home, openChat, loaded]);

  return (
    <div ref={group} className="group/agent flex flex-col gap-0.5">
      <div className="group/row relative">
        <NavItem
          icon={<AgentAvatar name={graduate.name} />}
          current={home}
          indicator={INDICATOR}
          className={home ? undefined : openChat ? 'bg-hover' : 'group-hover/row:bg-hover'}
          onClick={() => navigate(paths.agent(graduate.id))}
          end={
            showVersion && graduate.activeVersion !== null ? (
              <span className="font-mono">v{graduate.activeVersion}</span>
            ) : undefined
          }
        >
          <span className="font-medium">{graduate.name}</span>
        </NavItem>
        <div className={cn(GROUP_ACTIONS, home ? ON_SELECTED : openChat ? ON_IN_CHAT : ON_HOVER)}>
          <NewChatButton name={graduate.name} creating={creating} onClick={start} />
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
      <GroupChats chats={chats} route={route} />
    </div>
  );
}

/**
 * The Lab's teams (decision 100), each with its chats, under the agents. Nothing shows while they
 * load, and nothing when there are none: a team is made in Models.
 */
function TeamList({ route }: { route: Route }) {
  const teams = useTeams();
  if (teams.status === 'error' && !teams.data) {
    return (
      <ProblemState
        layout="inline"
        error={teams.error}
        title="Couldn't load your teams"
        onRetry={teams.reload}
        className="px-2.5"
      />
    );
  }
  if (!teams.data || teams.data.length === 0) return null;
  return (
    <div aria-label="Teams" role="group" className="flex flex-col gap-3">
      {teams.data.map((team) => (
        <TeamGroup key={team.id} team={team} route={route} />
      ))}
    </div>
  );
}

function TeamGroup({ team, route }: { team: Team; route: Route }) {
  const chats = useTeamChats(team.id);
  const { creating, start } = useStartChat(team.name, () => createTeamChat(team.id));
  return (
    <div className="group/agent flex flex-col gap-0.5">
      <div className="relative flex min-h-9 items-center gap-2.5 py-1.5 pl-2.5 pr-2.5">
        <RowIcon>
          <Users size={16} strokeWidth={1.8} aria-hidden />
        </RowIcon>
        <span className="line-clamp-2 min-w-0 flex-1 break-words font-medium">{team.name}</span>
        <div className={GROUP_ACTIONS}>
          {/* One action, so a team's longer name has room; the team itself is set in Models. */}
          <NewChatButton name={team.name} creating={creating} onClick={start} />
        </div>
      </div>
      <GroupChats chats={chats} route={route} />
    </div>
  );
}

/** How many of a group's chats the sidebar lists; its home lists them all. */
const RECENT_CHATS = 5;

/**
 * An agent's or a team's most recent chats, nested under it, with the open one among them
 * however old it is: an older one takes the last place, so the group keeps its height.
 */
function GroupChats({ chats, route }: { chats: ListState<WorkspaceChat[]>; route: Route }) {
  const open = route.name === 'chat' || route.name === 'team-chat' ? route.chatId : null;
  const openAt = chats.entry.data?.findIndex((chat) => chat.id === open) ?? -1;
  const recent = openAt >= RECENT_CHATS ? RECENT_CHATS - 1 : RECENT_CHATS;
  const list = chats.entry.data?.filter((chat, index) => index < recent || index === openAt);
  return (
    <>
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
        const current = open === chat.id;
        return (
          <StaggerItem key={chat.id} index={index}>
            <NavItem
              nested
              current={current}
              onClick={() => navigate(chatPath(chat))}
              end={
                // A chat waiting for an answer isn't working; the open one says so in the thread.
                // An icon, not a word, so the chat's title keeps its room.
                chat.waiting ? (
                  current ? undefined : (
                    <Tooltip content="Waiting for your approval" side="right">
                      <span className="inline-flex">
                        <ShieldCheck
                          size={16}
                          strokeWidth={1.8}
                          role="img"
                          aria-label="Waiting for your approval"
                        />
                      </span>
                    </Tooltip>
                  )
                ) : chat.running ? (
                  <Spinner tone="student" label="Working" />
                ) : undefined
              }
            >
              <span className="block truncate">{chat.title}</span>
            </NavItem>
          </StaggerItem>
        );
      })}
    </>
  );
}

/** What each kind of row leads with: a spinner while it trains, an icon of its own otherwise. */
function TrainingRowIcon({ kind }: { kind: TrainingRowKind }) {
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
      icon={<TrainingRowIcon kind={row.kind} />}
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
 * run that ends while they are elsewhere is never lost. With `drafts`, jobs drafted and never
 * trained follow; the Lab lists those in Fields.
 */
function TrainingList({
  jobs,
  route,
  drafts,
}: {
  jobs: JobSummary[];
  route: Route;
  drafts: boolean;
}) {
  const rows = trainingRows(jobs);
  const drafted = drafts ? draftedJobs(jobs) : [];
  if (rows.length === 0 && drafted.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 border-t border-line pt-4">
      {rows.map((row) => (
        <TrainingRowButton key={row.jobId} row={row} route={route} />
      ))}
      {drafted.map((job) => (
        <NavItem
          key={job.id}
          icon={<FilePen size={16} strokeWidth={1.8} aria-hidden />}
          current={route.name === 'define' && route.jobId === job.id}
          onClick={() => navigate(paths.define(job.id))}
          end={<span className="text-fg">Draft</span>}
        >
          {job.name}
        </NavItem>
      ))}
    </div>
  );
}
