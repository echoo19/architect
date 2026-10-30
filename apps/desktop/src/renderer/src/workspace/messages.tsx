import { memo } from 'react';
import type { AgentBlock, GraduateSummary, WorkspaceMessage } from '@architect/shared';
import { ErrorState, Reveal, Spinner } from '@architect/ui';
import { CirclePause } from 'lucide-react';
import { CopyButton } from '../components/CopyButton';
import { ApprovalCard, NoteBlock, RefusalCard, TableBlock } from './blocks';
import { Markdown } from './markdown/Markdown';
import type { PanelContent } from './SidePanel';
import { Steps } from './Steps';
import { FlagButton } from './teach/FlagButton';

export const UserMessage = memo(function UserMessage({ message }: { message: WorkspaceMessage }) {
  return (
    <Reveal className="flex max-w-[75%] self-end">
      <article aria-label="You" className="flex">
        <p className="m-0 min-w-0 whitespace-pre-wrap break-words rounded-card bg-raised px-5 py-3 leading-[1.55]">
          {message.text}
        </p>
      </article>
    </Reveal>
  );
});

/** Shown while the agent works on a reply that has nothing in it yet. */
export function Thinking() {
  return (
    <div role="status" className="flex h-7 items-center gap-2 text-ui text-fg">
      <Spinner size={13} />
      Thinking
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
  /** Opens Teach this for a settled reply. */
  onFlag: (message: WorkspaceMessage) => void;
}

export const AgentMessage = memo(function AgentMessage({
  message,
  agent,
  stepsStartOpen,
  onOpenPanel,
  onFlag,
}: AgentMessageProps) {
  const working = message.status === 'streaming';
  const answerable = working || message.status === 'done';
  const empty = message.steps.length === 0 && !message.text && message.blocks.length === 0;
  const stoppedQuietly =
    message.status === 'stopped' && !message.blocks.some((block) => block.kind === 'note');
  const waiting = answerable
    ? message.blocks.filter((block) => block.kind === 'approval' && block.status === 'pending')
    : [];
  const pending = waiting.length;
  // A change that couldn't be saved waits for "Try again" rather than for an approval.
  const retrying = waiting.some((block) => block.kind === 'approval' && block.error !== undefined);

  return (
    <Reveal>
      <article aria-label={agent.name} className="flex min-w-0 flex-col gap-[18px]">
        {message.steps.length > 0 && (
          <Steps
            message={message}
            startOpen={stepsStartOpen}
            waiting={pending > 0}
            onOpenPanel={onOpenPanel}
          />
        )}
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
                  agent={agent}
                  answerable={answerable}
                  onOpenPanel={onOpenPanel}
                />
              );
            case 'refusal':
              return <RefusalCard key={key} block={block} agent={agent} />;
            case 'note':
              return <NoteBlock key={key} text={block.text} />;
          }
        })}
        {pending > 0 && (
          <p role="status" className="m-0 flex items-center gap-2 text-ui text-fg">
            <CirclePause size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
            {retrying ? 'Waiting for you' : 'Waiting for your approval'}
          </p>
        )}
        {stoppedQuietly && <NoteBlock text="Stopped" />}
        {message.status === 'error' && (
          <ErrorState
            layout="inline"
            title={`${agent.name} stopped with an error`}
            message={message.error}
          />
        )}
        {/* A settled reply can be copied, and flagged for teaching. */}
        {!working && (message.text || message.status === 'done') && (
          <div className="-ml-2 -mt-2 flex">
            {message.text && <CopyButton text={message.text} />}
            {message.status === 'done' && <FlagButton onFlag={() => onFlag(message)} />}
          </div>
        )}
      </article>
    </Reveal>
  );
});
