import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { GraduateSummary } from '@architect/shared';
import { Badge, Button, EmptyState, ErrorState, Skeleton, Tooltip } from '@architect/ui';
import { Bot, Laptop } from 'lucide-react';
import { architect } from '../api/client';
import { useGraduates, useSettings } from '../api/hooks';
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
import { useBottomPin } from '../workspace/useBottomPin';

/** The header's status pill. The header drags the window, so the pill opts out to show its tip. */
const runningHere = (
  <Tooltip
    side="bottom"
    content={`This agent can't reach the internet. It only talks to the model on ${deviceInSentence(currentPlatform())}.`}
  >
    <span tabIndex={0} className="app-no-drag rounded-full">
      <Badge icon={<Laptop size={14} strokeWidth={1.6} aria-hidden />}>
        Running on {deviceInSentence(currentPlatform())}
      </Badge>
    </span>
  </Tooltip>
);

/** A chat with one graduated agent, running on this computer. */
export function ChatScreen({ graduateId, chatId }: { graduateId: string; chatId: string }) {
  const graduates = useGraduates();
  const agent = graduates.data?.find((graduate) => graduate.id === graduateId);

  if (agent) return <Chat agent={agent} chatId={chatId} />;
  return (
    <>
      <WorkspaceHeader actions={runningHere} />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-8 pb-14">
        {graduates.status === 'error' ? (
          <ErrorState
            title="Couldn't load your agents"
            message={graduates.error.message}
            onRetry={graduates.reload}
          />
        ) : graduates.status === 'success' ? (
          <EmptyState
            icon={<Bot aria-hidden />}
            title="This agent isn't here anymore"
            description="It may have been deleted. Your other agents are in the sidebar."
            actions={
              <Button variant="primary" size="md" onClick={() => navigate(paths.home())}>
                Go to your agents
              </Button>
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
      <Skeleton className="h-11 w-2/3 self-end rounded-[22px]" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <Skeleton className="h-36 w-full rounded-xl" />
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
        <ErrorState
          title="Couldn't open this chat"
          message={messages.entry.error}
          onRetry={messages.reload}
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
        actions={runningHere}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={viewport} className="min-h-0 flex-1 overflow-y-auto px-8 pb-[72px] pt-8">
            <div ref={content} className="mx-auto flex max-w-[720px] flex-col gap-10 text-chat">
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
    </>
  );
}
