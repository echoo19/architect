import type { GraduateSummary } from '@architect/shared';
import { AgentAvatar, Heading } from '@architect/ui';
import { useJob } from '../api/hooks';
import { suggestionsFor } from './labels';

export interface EmptyChatProps {
  agent: GraduateSummary;
  /** Puts a suggestion in the composer for the reader to finish and send. */
  onPick: (text: string) => void;
}

/** A new chat: the agent, what it was trained to do, and a few ways to start. */
export function EmptyChat({ agent, onPick }: EmptyChatProps) {
  const job = useJob(agent.manifest.jobId);
  // Wait for the job, so the suggestions don't change under the pointer when it arrives.
  const suggestions =
    job.status === 'loading' ? [] : suggestionsFor(agent.manifest, job.data?.taskTypes);
  return (
    <div className="flex min-h-[52vh] animate-rise flex-col items-center justify-center gap-6">
      <AgentAvatar name={agent.name} size="lg" />
      <div className="flex max-w-[520px] flex-col items-center gap-1.5 text-center">
        <Heading as="h2" size="title">
          {agent.name}
        </Heading>
        {job.data && (
          <p className="m-0 text-fg-secondary text-pretty">
            {job.data.summary ?? job.data.description}
          </p>
        )}
      </div>
      {suggestions.length > 0 && (
        <div
          role="group"
          aria-label={`Things to ask ${agent.name}`}
          className="flex flex-wrap justify-center gap-2 text-base"
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPick(suggestion)}
              className="h-10 rounded-lg border border-line-control px-4 text-fg-soft transition-colors duration-150 hover:border-fg-ghost hover:text-fg"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
