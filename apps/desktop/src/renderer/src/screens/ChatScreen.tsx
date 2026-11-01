import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  Consultation,
  GraduateSummary,
  Team,
  WorkspaceChat,
  WorkspaceMessage,
} from '@architect/shared';
import {
  AgentAvatar,
  Badge,
  Button,
  Drawer,
  DrawerContent,
  EmptyState,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
} from '@architect/ui';
import { Bot, CircleX, Info, Plus, Users, UserX } from 'lucide-react';
import { architect } from '../api/client';
import { useGraduates, useSettings } from '../api/hooks';
import { useTeams } from '../api/teams';
import { ProblemState } from '../components/ProblemState';
import { activeVersionName, agentModelName } from '../lib/names';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { WorkspaceHeader } from '../shell/WorkspaceShell';
import { ChatComposer } from '../workspace/ChatComposer';
import { draftFor, isToTeach, keepDraft } from '../workspace/drafts';
import { EmptyChat } from '../workspace/EmptyChat';
import { AgentMessage, Thinking, UserMessage } from '../workspace/messages';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import { SidePanel, type PanelContent } from '../workspace/SidePanel';
import {
  sendMessage,
  useAgentChats,
  useChatMessages,
  useTeamChats,
  type ListState,
} from '../workspace/store';
import { teachTarget } from '../workspace/teach/lessons';
import { TeachSheet } from '../workspace/teach/TeachSheet';
import { OrganizationMenu, TeamOrganizationMenu } from '../workspace/OrganizationMenu';
import { useBottomPin } from '../workspace/useBottomPin';

/** A team in a chat: its record, the lead that answers, and the teammates it may ask. */
interface ChatTeam {
  team: Team;
  teammates: readonly GraduateSummary[];
}

function BlockedBadge({ agent, named }: { agent: GraduateSummary; named: boolean }) {
  const device = deviceInSentence(currentPlatform());
  return (
    <Badge tone="danger" icon={<CircleX size={14} strokeWidth={1.6} aria-hidden />}>
      {named ? `${agent.name} can't run on ${device}` : `Can't run on ${device}`}
    </Badge>
  );
}

/**
 * The header's right side. An agent that can't run on this computer says so; one from a job with
 * several organizations names the one whose records it works on; and a quiet icon holds what the
 * footer under the message box used to say (the version and model that answer, and that they run
 * here), and opens the agent's settings.
 */
function AgentDetails({ agent }: { agent: GraduateSummary }) {
  const showSettings = useAgentSettingsUi((state) => state.show);
  const device = deviceInSentence(currentPlatform());
  const { adapter } = agent.manifest.student;
  const facts = [
    activeVersionName(agent),
    agentModelName(agent.manifest.student),
    adapter && (adapter.standIn ? 'Stand-in trained weights' : 'Trained weights'),
    `Runs on ${device}`,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-1">
      {agent.status === 'blocked' && <BlockedBadge agent={agent} named={false} />}
      <OrganizationMenu agent={agent} />
      <Tooltip
        content={
          <span className="flex flex-col">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </span>
        }
        side="bottom"
      >
        <IconButton label={`About ${agent.name}`} size="sm" onClick={() => showSettings(agent.id)}>
          <Info size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </Tooltip>
    </div>
  );
}

/**
 * A team chat's header side: each agent of the team on the records it works on, and a quiet icon
 * that opens what the team is: who leads and who it asks, at which version and for what, what a
 * teammate sees, and a way to change the team in Models.
 */
function TeamDetails({ agent, team }: { agent: GraduateSummary; team: ChatTeam }) {
  const members = [agent, ...team.teammates];
  const roleOf = (graduateId: string) =>
    team.team.members.find((member) => member.graduateId === graduateId)?.role;
  return (
    <div className="flex items-center gap-1">
      {members
        .filter((member) => member.status === 'blocked')
        .map((member) => (
          <BlockedBadge key={member.id} agent={member} named />
        ))}
      <TeamOrganizationMenu agents={members} />
      <Popover>
        <PopoverTrigger asChild>
          <IconButton label={`About ${team.team.name}`} size="sm">
            <Info size={16} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" aria-label={team.team.name} className="w-80">
          <p className="m-0 text-ui font-medium">{team.team.name}</p>
          <p className="m-0 mt-1 text-small text-pretty">
            {`${agent.name} answers, and asks its teammates for their part. A teammate sees only what it is asked, never this chat, and works on its own files with its own permissions.`}
          </p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
            {members.map((member) => {
              const role = member.id === agent.id ? 'Leads' : roleOf(member.id);
              return (
                <li key={member.id} className="flex items-start gap-2.5">
                  <AgentAvatar name={member.name} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-ui">
                      {`${member.name}, ${activeVersionName(member).toLowerCase()}`}
                    </span>
                    {role && <span className="text-small text-pretty">{role}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-3 text-small">
            {`Not certified as a team. Runs on ${deviceInSentence(currentPlatform())}.`}
          </p>
          <Button size="xs" className="mt-3" onClick={() => navigate(paths.teams())}>
            Edit team
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** A page in place of a chat: loading, a failed read, or what is gone. */
function ChatPlaceholder({ children }: { children: ReactNode }) {
  return (
    <>
      <WorkspaceHeader />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-8 pb-14">
        {children}
      </div>
    </>
  );
}

/** A chat with one graduated agent, running on this computer. */
export function ChatScreen({ graduateId, chatId }: { graduateId: string; chatId: string }) {
  const graduates = useGraduates();
  const agent = graduates.data?.find((graduate) => graduate.id === graduateId);

  if (agent) return <AgentChat agent={agent} chatId={chatId} />;
  return (
    <ChatPlaceholder>
      {graduates.status === 'error' ? (
        <ProblemState
          error={graduates.error}
          title="Couldn't load your agents"
          onRetry={graduates.reload}
        />
      ) : graduates.status === 'success' ? (
        <EmptyState
          icon={<Bot aria-hidden />}
          title="This agent was deleted."
          actions={
            graduates.data.length > 0 ? (
              <Button variant="primary" size="md" onClick={() => navigate(paths.home())}>
                Go to your agents
              </Button>
            ) : (
              <Button variant="primary" size="md" onClick={() => navigate(paths.newAgent())}>
                <Plus size={16} aria-hidden />
                New agent
              </Button>
            )
          }
        />
      ) : (
        <ChatSkeleton />
      )}
    </ChatPlaceholder>
  );
}

/**
 * A chat with a team (decision 100): its lead answers, asking its teammates for their parts, and
 * each agent works on its own records on this computer.
 */
export function TeamChatScreen({ teamId, chatId }: { teamId: string; chatId: string }) {
  const graduates = useGraduates();
  const teams = useTeams();
  const team = teams.data?.find((item) => item.id === teamId);
  const members = team?.members.map((member) =>
    graduates.data?.find((graduate) => graduate.id === member.graduateId),
  );
  const [lead, ...teammates] = members ?? [];

  if (team && lead && teammates.every((member): member is GraduateSummary => !!member)) {
    return <TeamChat agent={lead} team={{ team, teammates }} chatId={chatId} />;
  }
  const failed = graduates.status === 'error' ? graduates : teams.status === 'error' ? teams : null;
  return (
    <ChatPlaceholder>
      {failed?.error ? (
        <ProblemState
          error={failed.error}
          title={failed === teams ? "Couldn't load your teams" : "Couldn't load your agents"}
          onRetry={failed.reload}
        />
      ) : graduates.status === 'success' && teams.status === 'success' ? (
        <EmptyState
          icon={<Users aria-hidden />}
          title="This team was deleted."
          actions={
            <Button variant="primary" size="md" onClick={() => navigate(paths.teams())}>
              Go to your teams
            </Button>
          }
        />
      ) : (
        <ChatSkeleton />
      )}
    </ChatPlaceholder>
  );
}

function ChatSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading messages"
      className="flex w-full max-w-[720px] flex-col gap-10 self-start"
    >
      <Skeleton className="h-11 w-2/3 self-end rounded-card" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <Skeleton className="h-36 w-full rounded-control" />
    </div>
  );
}

interface ChatProps {
  /** The agent that answers: in a team chat, the team's lead. */
  agent: GraduateSummary;
  chatId: string;
}

function AgentChat(props: ChatProps) {
  return <Chat {...props} chats={useAgentChats(props.agent.id)} />;
}

/**
 * A team's chat, once the team's own list holds it: a chat of another team or of an agent never
 * shows, or takes a message, under this team's name. A chat started elsewhere may be missing from
 * a list read earlier, so the list is read once more before the chat is called missing.
 */
function TeamChat(props: ChatProps & { team: ChatTeam }) {
  const { team, chatId } = props;
  const chats = useTeamChats(team.team.id);
  const ours = chats.entry.data?.some((chat) => chat.id === chatId && chat.teamId === team.team.id);
  const [reread, setReread] = useState(false);
  const { status } = chats.entry;
  const { reload } = chats;
  useEffect(() => {
    if (status !== 'ready' || ours || reread) return;
    setReread(true);
    reload();
  }, [status, ours, reread, reload]);
  if (ours) return <Chat {...props} chats={chats} />;
  return (
    <ChatPlaceholder>
      {chats.entry.status === 'error' ? (
        <ProblemState
          error={chats.entry.error}
          title={`Couldn't load ${team.team.name}'s chats`}
          onRetry={chats.reload}
        />
      ) : reread && chats.entry.status === 'ready' ? (
        <EmptyState
          icon={<Users aria-hidden />}
          title={`This chat isn't in ${team.team.name}.`}
          actions={
            <Button variant="primary" size="md" onClick={() => navigate(paths.teams())}>
              Go to your teams
            </Button>
          }
        />
      ) : (
        <ChatSkeleton />
      )}
    </ChatPlaceholder>
  );
}

/** What Teach this opens on: a reply, or a teammate's answer inside one. */
interface Flagged {
  reply: WorkspaceMessage;
  consultation?: Consultation;
  open: boolean;
  count: number;
}

function Chat({
  agent,
  team,
  chatId,
  chats,
}: ChatProps & { team?: ChatTeam; chats: ListState<WorkspaceChat[]> }) {
  const messages = useChatMessages(chatId);
  const settings = useSettings();
  const chat = chats.entry.data?.find((item) => item.id === chatId);
  const list = messages.entry.data;

  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const { pinned, pinToBottom } = useBottomPin(viewport, content);

  const [draft, setDraft] = useState(() => draftFor(chatId));
  const changeDraft = (text: string) => {
    setDraft(text);
    keepDraft(chatId, text);
  };

  // A chat started elsewhere (the report screen, the command menu) may be missing from a list
  // read earlier; read the list once more.
  const missing = chats.entry.status === 'ready' && !chat;
  const reread = useRef(false);
  const { reload: reloadChats } = chats;
  useEffect(() => {
    if (!missing || reread.current) return;
    reread.current = true;
    reloadChats();
  }, [missing, reloadChats]);

  const [panel, setPanel] = useState<PanelContent | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openPanel = useCallback((next: PanelContent) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next);
  }, []);
  const closePanel = useCallback(() => {
    setPanel(null);
    opener.current?.focus();
  }, []);
  useEffect(() => {
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel, closePanel]);

  // The answer being taught from. It stays set while the sheet animates closed, and each flag
  // starts a fresh sheet, even on an answer flagged before.
  const [flagged, setFlagged] = useState<Flagged | null>(null);
  const flag = useCallback(
    (reply: WorkspaceMessage, consultation?: Consultation) =>
      setFlagged((current) => ({
        reply,
        ...(consultation ? { consultation } : {}),
        open: true,
        count: (current?.count ?? 0) + 1,
      })),
    [],
  );
  const closeSheet = useCallback(
    () => setFlagged((current) => current && { ...current, open: false }),
    [],
  );

  const send = async (text: string) => {
    changeDraft('');
    pinToBottom();
    const sent = await attempt("Couldn't send that message", async () => {
      await sendMessage(chatId, text);
      return true;
    });
    if (!sent) changeDraft(text);
  };

  const pick = (text: string) => {
    changeDraft(text);
    requestAnimationFrame(() => {
      const input = field.current?.querySelector('textarea');
      input?.focus();
      input?.setSelectionRange(text.length, text.length);
    });
  };

  const awaitingReply = chat?.running === true && list?.at(-1)?.role === 'user';
  // The reply waits on the person's answer to a write it wants to make.
  const last = list?.at(-1);
  const approving =
    chat?.running === true &&
    last?.role === 'agent' &&
    last.blocks.some((block) => block.kind === 'approval' && block.status === 'pending');
  const stepsStartOpen = settings.data?.steps === 'expanded';

  let body: ReactNode;
  if (list === undefined) {
    body =
      messages.entry.status === 'error' ? (
        <ProblemState
          error={messages.entry.error}
          title="Couldn't open this chat"
          onRetry={messages.reload}
          exit={{ label: 'Back to agents', onClick: () => navigate(paths.home()) }}
          className="min-h-[52vh]"
        />
      ) : (
        <ChatSkeleton />
      );
  } else if (list.length === 0) {
    body = (
      <EmptyChat
        agent={agent}
        {...(team ? { team: { name: team.team.name, teammates: team.teammates } } : {})}
        toTeach={isToTeach(chatId)}
        onPick={pick}
      />
    );
  } else {
    body = (
      <>
        {list.map((message) =>
          message.role === 'user' ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AgentMessage
              key={message.id}
              message={message}
              agent={agent}
              stepsStartOpen={stepsStartOpen}
              onOpenPanel={openPanel}
              onFlag={flag}
              {...(team ? { teammates: team.teammates, onFlagConsultation: flag } : {})}
            />
          ),
        )}
        {awaitingReply && <Thinking />}
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader
        title={
          chat?.title ??
          (chats.entry.status === 'loading' ? <Skeleton className="h-3.5 w-44" /> : 'Chat')
        }
        actions={team ? <TeamDetails agent={agent} team={team} /> : <AgentDetails agent={agent} />}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto px-8 pb-[72px] pt-8">
            <div ref={content} className="mx-auto flex max-w-[720px] flex-col gap-10 text-body">
              {body}
            </div>
          </div>
          <ChatComposer
            agent={agent}
            {...(team ? { team: team.team.name } : {})}
            draft={draft}
            onDraftChange={changeDraft}
            onSend={(text) => void send(text)}
            onStop={() =>
              void attempt(`Couldn't stop ${agent.name}`, () => architect().workspace.stop(chatId))
            }
            running={chat?.running ?? false}
            approving={approving}
            disabled={list === undefined}
            pinned={pinned}
            onJumpToLatest={pinToBottom}
            fieldRef={field}
          />
        </div>
        {panel && <SidePanel content={panel} onClose={closePanel} />}
      </div>
      <Drawer open={flagged?.open ?? false} onOpenChange={(open) => !open && closeSheet()}>
        {flagged && (
          <Teach key={flagged.count} flagged={flagged} agent={agent} onClose={closeSheet} />
        )}
      </Drawer>
    </>
  );
}

/**
 * Teach this for what was flagged. A teammate's answer teaches the teammate, at the version that
 * gave it; a team reply teaches the lead. Either way, every agent whose work the exchange holds
 * must allow sharing it: the teammate and the lead, or the lead and each teammate it asked.
 */
function Teach({
  flagged,
  agent,
  onClose,
}: {
  flagged: Flagged;
  agent: GraduateSummary;
  onClose: () => void;
}) {
  const graduates = useGraduates();
  const target = teachTarget(flagged.reply, flagged.consultation, agent, graduates.data ?? []);
  if (target.kind === 'gone') {
    return (
      <DrawerContent
        title="Teach this"
        footer={
          <Button size="md" onClick={onClose}>
            Close
          </Button>
        }
      >
        <EmptyState
          icon={<UserX aria-hidden />}
          title={`${target.name} is gone`}
          description={`${target.name} was deleted after this answer, so there is no agent to teach from it.`}
          className="min-h-[50vh]"
        />
      </DrawerContent>
    );
  }
  if (target.kind === 'consultation') {
    return (
      <TeachSheet
        agent={target.agent}
        reply={flagged.reply}
        consultation={{ consultation: target.consultation, lead: agent }}
        alsoSharing={target.alsoSharing}
        onClose={onClose}
      />
    );
  }
  return (
    <TeachSheet
      agent={agent}
      reply={flagged.reply}
      alsoSharing={target.alsoSharing}
      onClose={onClose}
    />
  );
}
