import { useMemo, useRef, useState } from 'react';
import type { GraduateSummary } from '@architect/shared';
import {
  Badge,
  Button,
  Composer,
  EmptyState,
  IconButton,
  Skeleton,
  Stagger,
  Tooltip,
  VersionTag,
} from '@architect/ui';
import { Bot, CircleX, Ellipsis, MessageSquare, Plus } from 'lucide-react';
import { useVersionReport, useVersions } from '../api/graduates';
import { useGraduates } from '../api/hooks';
import { useTeams } from '../api/teams';
import { activityEnd, sessionRows } from '../agent/activity';
import { ActivityCard, DeploymentCard, EvidenceCard, SessionsCard, WorkCard } from '../agent/cards';
import { ProblemState } from '../components/ProblemState';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { chatPath, navigate, paths } from '../lib/router';
import { useEdition } from '../shell/edition';
import { PlacePage } from '../shell/PlacePage';
import { suggestionsFor } from '../workspace/labels';
import { useAgentSettingsUi } from '../workspace/settings/agentSettingsUi';
import {
  createChat,
  sendMessage,
  useAgentChats,
  useChatsMessages,
  useTeamsChats,
} from '../workspace/store';

/**
 * An agent's home, where opening it lands: a box that starts a session with the agent's own
 * starter requests, its sessions, and what its work on this computer comes to.
 */
export function AgentScreen({ graduateId }: { graduateId: string }) {
  const graduates = useGraduates();
  const edition = useEdition();
  const agent = graduates.data?.find((graduate) => graduate.id === graduateId);

  if (agent && edition === 'lab') return <LabAgentHome agent={agent} />;
  if (agent && edition === 'personal') return <AgentHome agent={agent} teamIds={NO_TEAMS} />;
  if (graduates.status === 'error') {
    return (
      <PlacePage title="Agent">
        <ProblemState
          error={graduates.error}
          title="Couldn't load your agents"
          onRetry={graduates.reload}
          className="pt-16"
        />
      </PlacePage>
    );
  }
  if (graduates.status === 'success' && !agent) {
    return (
      <PlacePage title="Agent">
        <EmptyState
          icon={<Bot aria-hidden />}
          title="This agent was deleted."
          className="pt-16"
          actions={
            <Button variant="primary" size="md" onClick={() => navigate(paths.home())}>
              Go home
            </Button>
          }
        />
      </PlacePage>
    );
  }
  return (
    <PlacePage title="Agent">
      <HomeSkeleton />
    </PlacePage>
  );
}

const NO_TEAMS: readonly string[] = [];

/** In the Lab, an agent's home also holds the chats of the teams it leads (decision 100). */
function LabAgentHome({ agent }: { agent: GraduateSummary }) {
  const teams = useTeams();
  const led = useMemo(
    () =>
      (teams.data ?? [])
        .filter((team) => team.members[0]?.graduateId === agent.id)
        .map((team) => team.id),
    [teams.data, agent.id],
  );
  return <AgentHome agent={agent} teamIds={led} />;
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the agent" className="flex flex-col gap-4">
      <Skeleton className="h-32 rounded-card" />
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}

const COLUMN = 'flex min-w-0 flex-col gap-4';

function AgentHome({ agent, teamIds }: { agent: GraduateSummary; teamIds: readonly string[] }) {
  const chats = useAgentChats(agent.id);
  const teamChats = useTeamsChats(teamIds);
  const all = useMemo(
    () => [...(chats.entry.data ?? []), ...teamChats],
    [chats.entry.data, teamChats],
  );
  const messages = useChatsMessages(all.map((chat) => chat.id));
  const report = useVersionReport(agent);
  const showSettings = useAgentSettingsUi((state) => state.show);
  // The day the page opened on: the chart and the times read against it.
  const [now] = useState(() => new Date());

  const loaded = chats.entry.status !== 'loading' && messages.entry.status === 'ready';
  const byChat = messages.entry.status === 'ready' ? messages.entry.data : {};
  const sessions = all.map((chat) => ({ chat, messages: byChat[chat.id] ?? [] }));
  const everything = sessions.flatMap((session) => session.messages);
  const latest = all.reduce<(typeof all)[number] | undefined>(
    (best, chat) => (!best || chat.updatedAt > best.updatedAt ? chat : best),
    undefined,
  );
  const failure =
    chats.entry.status === 'error'
      ? { error: chats.entry.error, retry: chats.reload }
      : messages.entry.status === 'error'
        ? { error: messages.entry.error, retry: messages.reload }
        : null;

  return (
    <PlacePage
      title={agent.name}
      status={
        <>
          {agent.activeVersion !== null && <VersionTag version={agent.activeVersion} active />}
          {agent.status === 'blocked' && (
            <Badge tone="danger" icon={<CircleX size={14} strokeWidth={1.6} aria-hidden />}>
              {`Can't run on ${deviceInSentence(currentPlatform())}`}
            </Badge>
          )}
        </>
      }
      action={
        <div className="flex items-center gap-1">
          {latest && (
            <Tooltip content="Open the last session" side="bottom">
              <IconButton label="Open the last session" onClick={() => navigate(chatPath(latest))}>
                <MessageSquare size={16} strokeWidth={1.8} aria-hidden />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip content="Agent settings" side="bottom">
            <IconButton label={`${agent.name} settings`} onClick={() => showSettings(agent.id)}>
              <Ellipsis size={16} strokeWidth={1.8} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>
      }
    >
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Stagger className={COLUMN}>
          <Dispatch agent={agent} />
          {failure ? (
            <ProblemState
              error={failure.error}
              title={`Couldn't read ${agent.name}'s sessions`}
              onRetry={failure.retry}
            />
          ) : loaded ? (
            <>
              <ActivityCard messages={everything} end={activityEnd(everything, now)} />
              <SessionsCard rows={sessionRows(sessions)} now={now} />
            </>
          ) : (
            <Skeleton className="h-80 rounded-card" />
          )}
        </Stagger>
        <Stagger className={COLUMN}>
          <DeploymentCard agent={agent} report={report.data} />
          {report.data && <EvidenceCard agent={agent} report={report.data} />}
          {loaded && !failure && <WorkCard messages={everything} />}
        </Stagger>
      </div>
    </PlacePage>
  );
}

/**
 * Starts a session from the home: the request goes to a new chat, which works while the person
 * stays here and shows at the top of the sessions. The agent's starter requests fill the box.
 */
function Dispatch({ agent }: { agent: GraduateSummary }) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const versions = useVersions(agent.id);
  const taskTypes = versions.data?.find((version) => version.active)?.manifest.contract.capabilities
    .taskTypes;
  // Wait for the version's task types, so the requests don't change under the pointer.
  const starters =
    versions.data || versions.status === 'error' ? suggestionsFor(agent.manifest, taskTypes) : [];
  const blocked = agent.status === 'blocked';

  const dispatch = async (text: string) => {
    setDraft('');
    setSending(true);
    const sent = await attempt(`Couldn't start a session with ${agent.name}`, async () => {
      const chat = await createChat(agent.id);
      await sendMessage(chat.id, text);
      return true;
    });
    setSending(false);
    if (!sent) setDraft(text);
  };

  const pick = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      const input = field.current?.querySelector('textarea');
      input?.focus();
      input?.setSelectionRange(text.length, text.length);
    });
  };

  return (
    <section aria-label="New session" className="flex flex-col gap-3">
      <div ref={field}>
        <Composer
          size="hero"
          className="max-w-none"
          label={`New session with ${agent.name}`}
          placeholder={`Ask ${agent.name}`}
          value={draft}
          onValueChange={setDraft}
          onSubmit={(text) => void dispatch(text)}
          disabled={blocked || sending}
          leading={
            <span className="flex items-center gap-1.5 pl-1 text-small">
              <Plus size={14} strokeWidth={1.8} aria-hidden />
              New session
            </span>
          }
        />
      </div>
      {starters.length > 0 && (
        <div
          role="group"
          aria-label={`Things to ask ${agent.name}`}
          className="flex flex-wrap gap-2 text-ui"
        >
          {starters.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => pick(starter)}
              className="h-9 rounded-full px-3.5 text-fg transition-colors duration-150 shadow-edge-strong hover:bg-hover"
            >
              {starter}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
