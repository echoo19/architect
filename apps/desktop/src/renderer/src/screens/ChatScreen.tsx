import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GraduateSummary, InstallStatus, WorkspaceMessage } from '@architect/shared';
import { Badge, Button, Drawer, EmptyState, Skeleton } from '@architect/ui';
import { Bot, CircleX, Laptop, Plus } from 'lucide-react';
import { architect } from '../api/client';
import { useGraduates, useSettings } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { navigate, paths } from '../lib/router';
import { WorkspaceHeader } from '../shell/WorkspaceShell';
import { ChatComposer } from '../workspace/ChatComposer';
import { draftFor, keepDraft } from '../workspace/drafts';
import { EmptyChat } from '../workspace/EmptyChat';
import { AgentMessage, Thinking, UserMessage } from '../workspace/messages';
import { SidePanel, type PanelContent } from '../workspace/SidePanel';
import { sendMessage, useAgentChats, useChatMessages } from '../workspace/store';
import { TeachSheet } from '../workspace/teach/TeachSheet';
import { useBottomPin } from '../workspace/useBottomPin';

/** The request a reply answered: the person's message before it in the chat. */
function requestOf(messages: readonly WorkspaceMessage[], reply: WorkspaceMessage): string {
  const index = messages.findIndex((message) => message.id === reply.id);
  return (
    messages
      .slice(0, Math.max(0, index))
      .reverse()
      .find((message) => message.role === 'user')?.text ?? ''
  );
}

/**
 * The header's status pill: the agent makes no network calls beyond its local model. When this
 * computer's install checks say it can't run here, the pill says that instead.
 */
function hereBadge(status?: InstallStatus) {
  const device = deviceInSentence(currentPlatform());
  return status === 'blocked' ? (
    <Badge tone="danger" icon={<CircleX size={14} strokeWidth={1.6} aria-hidden />}>
      Can&apos;t run on {device}
    </Badge>
  ) : (
    <Badge icon={<Laptop size={14} strokeWidth={1.6} aria-hidden />}>Running on {device}</Badge>
  );
}

/** A chat with one graduated agent, running on this computer. */
export function ChatScreen({ graduateId, chatId }: { graduateId: string; chatId: string }) {
  const graduates = useGraduates();
  const agent = graduates.data?.find((graduate) => graduate.id === graduateId);

  if (agent) return <Chat agent={agent} chatId={chatId} />;
  return (
    <>
      <WorkspaceHeader actions={hereBadge()} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-8 pb-14">
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
      </div>
    </>
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

function Chat({ agent, chatId }: { agent: GraduateSummary; chatId: string }) {
  const chats = useAgentChats(agent.id);
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

  // The reply being taught from. It stays set while the sheet animates closed, and each flag
  // starts a fresh sheet, even on a reply flagged before.
  const [flagged, setFlagged] = useState<{
    reply: WorkspaceMessage;
    open: boolean;
    count: number;
  } | null>(null);
  const flag = useCallback(
    (reply: WorkspaceMessage) =>
      setFlagged((current) => ({ reply, open: true, count: (current?.count ?? 0) + 1 })),
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
    body = <EmptyChat agent={agent} onPick={pick} />;
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
        actions={hereBadge(agent.status)}
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
            draft={draft}
            onDraftChange={changeDraft}
            onSend={(text) => void send(text)}
            onStop={() =>
              void attempt(`Couldn't stop ${agent.name}`, () => architect().workspace.stop(chatId))
            }
            running={chat?.running ?? false}
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
          <TeachSheet
            key={flagged.count}
            agent={agent}
            reply={flagged.reply}
            request={requestOf(list ?? [], flagged.reply)}
            onClose={closeSheet}
          />
        )}
      </Drawer>
    </>
  );
}
