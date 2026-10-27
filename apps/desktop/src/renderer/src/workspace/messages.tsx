import { memo, useEffect, useState } from 'react';
import type { AgentBlock, GraduateSummary, WorkspaceMessage } from '@architect/shared';
import { ErrorState, IconButton, Spinner, Tooltip } from '@architect/ui';
import { Check, Copy } from 'lucide-react';
import { attempt } from '../lib/notify';
import { ApprovalCard, NoteBlock, RefusalCard, TableBlock } from './blocks';
import { Markdown } from './markdown/Markdown';
import type { PanelContent } from './SidePanel';
import { Steps } from './Steps';

export const UserMessage = memo(function UserMessage({ message }: { message: WorkspaceMessage }) {
  return (
    <article aria-label="You" className="flex max-w-[75%] animate-rise self-end">
      <p className="m-0 min-w-0 whitespace-pre-wrap break-words rounded-[22px] bg-bubble px-[18px] py-[11px] leading-[1.55]">
        {message.text}
      </p>
    </article>
  );
});

/** Shown while the agent works on a reply that has nothing in it yet. */
export function Thinking() {
  return (
    <div role="status" className="flex h-7 items-center gap-2 text-base text-fg-secondary">
      <Spinner size={13} />
      Thinking
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const done = await attempt("Couldn't copy the reply", async () => {
      await navigator.clipboard.writeText(text);
      return true;
    });
    if (done) setCopied(true);
  };

  const label = copied ? 'Copied' : 'Copy';
  return (
    <div className="-ml-2 -mt-2 flex animate-fade">
      <Tooltip content={label}>
        <IconButton label={label} size="sm" className="text-fg-muted" onClick={() => void copy()}>
          {copied ? (
            <Check size={15} strokeWidth={2} aria-hidden />
          ) : (
            <Copy size={15} strokeWidth={1.7} aria-hidden />
          )}
        </IconButton>
      </Tooltip>
    </div>
  );
}

function blockKey(block: AgentBlock, index: number): string {
  return block.kind === 'approval' ? block.changeId : `${block.kind}-${index}`;
}

export interface AgentMessageProps {
  message: WorkspaceMessage;
  agent: GraduateSummary;
  /** Whether finished steps start open, from the "Tool steps" setting. */
  stepsStartOpen: boolean;
  onOpenPanel: (content: PanelContent) => void;
}

export const AgentMessage = memo(function AgentMessage({
  message,
  agent,
  stepsStartOpen,
  onOpenPanel,
}: AgentMessageProps) {
  const working = message.status === 'streaming';
  const empty = message.steps.length === 0 && !message.text && message.blocks.length === 0;
  const stoppedQuietly =
    message.status === 'stopped' && !message.blocks.some((block) => block.kind === 'note');

  return (
    <article aria-label={agent.name} className="flex min-w-0 animate-rise flex-col gap-[18px]">
      {message.steps.length > 0 && <Steps message={message} startOpen={stepsStartOpen} />}
      {working && empty && <Thinking />}
      {message.text && <Markdown text={message.text} />}
      {message.blocks.map((block, index) => {
        const key = blockKey(block, index);
        switch (block.kind) {
          case 'table':
            return <TableBlock key={key} block={block} onOpenPanel={onOpenPanel} />;
          case 'approval':
            return (
              <ApprovalCard
                key={key}
                block={block}
                graduateId={agent.id}
                answerable={message.status === 'streaming' || message.status === 'done'}
                onOpenPanel={onOpenPanel}
              />
            );
          case 'refusal':
            return <RefusalCard key={key} block={block} agent={agent} />;
          case 'note':
            return <NoteBlock key={key} text={block.text} />;
        }
      })}
      {stoppedQuietly && <NoteBlock text="Stopped" />}
      {message.status === 'error' && (
        <ErrorState
          layout="inline"
          title={`${agent.name} stopped with an error`}
          message={message.error}
        />
      )}
      {!working && message.text && <CopyButton text={message.text} />}
    </article>
  );
});
