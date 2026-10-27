import { useState } from 'react';
import type { WorkspaceMessage } from '@architect/shared';
import {
  AgentAvatar,
  Badge,
  Composer,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusDot,
} from '@architect/ui';
import { api, architect } from '../api/client';
import { queryKeys, useChats, useGraduates, useMessages } from '../api/hooks';
import { fetchQuery } from '../api/query';
import { attempt } from '../lib/notify';
import { currentPlatform, deviceInSentence } from '../lib/platform';
import { WorkspaceHeader } from '../shell/WorkspaceShell';

export function ChatScreen({ graduateId, chatId }: { graduateId: string; chatId: string }) {
  const graduates = useGraduates();
  const chats = useChats(graduateId);
  const messages = useMessages(chatId);
  const [draft, setDraft] = useState('');

  const graduate = graduates.data?.find((g) => g.id === graduateId);
  const chat = chats.data?.find((c) => c.id === chatId);
  const name = graduate?.name ?? 'the agent';

  const send = async (text: string) => {
    const sent = await attempt("Couldn't send that message", async () => {
      await architect().workspace.send(chatId, text);
      return true;
    });
    if (!sent) return;
    setDraft('');
    await fetchQuery(queryKeys.messages(chatId), () => api.messages(chatId));
  };

  return (
    <>
      <WorkspaceHeader
        title={
          chat?.title ?? (chats.status === 'loading' ? <Skeleton className="h-3.5 w-44" /> : 'Chat')
        }
        actions={<Badge icon={<StatusDot tone="neutral" size={6} />}>Offline</Badge>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-[72px] pt-8">
        <div className="mx-auto flex h-full max-w-[720px] flex-col gap-10 text-chat">
          {messages.status === 'loading' && <ChatSkeleton />}
          {messages.status === 'error' && (
            <ErrorState
              title="Couldn't open this chat"
              message={messages.error.message}
              onRetry={messages.reload}
              className="min-h-[52vh]"
            />
          )}
          {messages.status === 'success' && messages.data.length === 0 && (
            <EmptyState
              icon={<AgentAvatar name={name} size="lg" />}
              iconTile={false}
              title={`Ask ${name}`}
              description={`It runs on ${deviceInSentence(currentPlatform())} and never goes online.`}
              className="min-h-[52vh]"
            />
          )}
          {messages.status === 'success' &&
            messages.data.map((message) => <Message key={message.id} message={message} />)}
        </div>
      </div>
      <div className="relative shrink-0 px-8 pb-[18px]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-linear-to-b from-transparent to-ground"
        />
        <Composer
          className="mx-auto"
          label={`Message ${name}`}
          placeholder={`Ask ${name}`}
          value={draft}
          onValueChange={setDraft}
          onSubmit={(text) => void send(text)}
          busy={chat?.running ?? false}
          onStop={() =>
            void attempt("Couldn't stop the reply", () => architect().workspace.stop(chatId))
          }
          disabled={messages.status !== 'success'}
          trailing={
            graduate && (
              <span className="text-sm text-fg-muted">
                {name} v{graduate.manifest.harness.version}
              </span>
            )
          }
        />
      </div>
    </>
  );
}

function ChatSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading messages" className="flex flex-col gap-10">
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

function Message({ message }: { message: WorkspaceMessage }) {
  if (message.role === 'user') {
    return (
      <p className="m-0 max-w-[75%] animate-rise self-end whitespace-pre-wrap rounded-[22px] bg-bubble px-[18px] py-[11px] leading-[1.55]">
        {message.text}
      </p>
    );
  }
  return (
    <div className="flex animate-rise flex-col gap-[18px]">
      {message.text && <p className="m-0 whitespace-pre-wrap text-pretty">{message.text}</p>}
      {message.status === 'error' && message.error && (
        <ErrorState
          layout="inline"
          title="The agent stopped with an error"
          message={message.error}
        />
      )}
    </div>
  );
}
