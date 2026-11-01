import { memo } from 'react';
import type {
  AgentBlock,
  Consultation,
  GraduateSummary,
  WorkspaceMessage,
} from '@architect/shared';
import { AgentAvatar, ErrorState, Reveal, Spinner } from '@architect/ui';
import { CopyButton } from '../components/CopyButton';
import { ApprovalCard, NoteBlock, RefusalCard, TableBlock } from './blocks';
import { writerOf } from './changes';
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

/**
 * Who answered a team reply, and whom it asked: "Inventory desk asked Assay desk", so the reply
 * says it before its steps are opened.
 */
function ReplyAuthor({ agent, message }: { agent: GraduateSummary; message: WorkspaceMessage }) {
  const asked = [
    ...new Set(message.steps.filter((step) => step.kind === 'consult').map((step) => step.name)),
  ];
  return (
    <p className="m-0 -mb-2 flex items-center gap-2 text-ui">
      <AgentAvatar name={agent.name} className="size-5" />
      <span>
        <span className="font-medium">{agent.name}</span>
        {asked.length > 0 && ` asked ${asked.join(' and ')}`}
      </span>
    </p>
  );
}

function blockKey(block: AgentBlock, index: number): string {
  return block.kind === 'approval' ? block.changeId : `${block.kind}-${index}`;
}

export interface AgentMessageProps {
  message: WorkspaceMessage;
  /** The agent that answers: in a team chat, the team's lead. */
  agent: GraduateSummary;
  /** In a team chat, the lead's teammates, whose writes and answers the reply can hold. */
  teammates?: readonly GraduateSummary[];
  /** Whether finished steps start open, from the "Tool steps" setting. */
  stepsStartOpen: boolean;
  onOpenPanel: (content: PanelContent) => void;
  /** Opens Teach this for a settled reply. */
  onFlag: (message: WorkspaceMessage) => void;
  /** In a team chat, opens Teach this for a teammate's answer in a settled reply. */
  onFlagConsultation?: (message: WorkspaceMessage, consultation: Consultation) => void;
}

export const AgentMessage = memo(function AgentMessage({
  message,
  agent,
  teammates,
  stepsStartOpen,
  onOpenPanel,
  onFlag,
  onFlagConsultation,
}: AgentMessageProps) {
  const working = message.status === 'streaming';
  const answerable = working || message.status === 'done';
  const empty = message.steps.length === 0 && !message.text && message.blocks.length === 0;
  const stoppedQuietly =
    message.status === 'stopped' && !message.blocks.some((block) => block.kind === 'note');
  const waiting = answerable
    ? message.blocks.filter((block) => block.kind === 'approval' && block.status === 'pending')
    : [];
  // The approval cards' own buttons say that the reply waits, so nothing else here repeats it.
  const pending = waiting.length;

  return (
    <Reveal>
      <article aria-label={agent.name} className="flex min-w-0 flex-col gap-[18px]">
        {teammates !== undefined && <ReplyAuthor agent={agent} message={message} />}
        {message.steps.length > 0 && (
          <Steps
            message={message}
            startOpen={stepsStartOpen}
            waiting={pending > 0}
            onOpenPanel={onOpenPanel}
            {...(onFlagConsultation
              ? { onFlagConsultation: (consultation) => onFlagConsultation(message, consultation) }
              : {})}
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
                  agent={writerOf(block, agent)}
                  named={teammates !== undefined}
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
            {message.status === 'done' && (
              <FlagButton graduateId={agent.id} onFlag={() => onFlag(message)} />
            )}
          </div>
        )}
      </article>
    </Reveal>
  );
});
