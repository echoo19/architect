import type { GraduateSummary } from '@architect/shared';
import { AgentAvatar } from '@architect/ui';
import { suggestionsFor } from './labels';

export interface EmptyChatProps {
  agent: GraduateSummary;
  /** Puts a suggestion in the composer for the reader to finish and send. */
  onPick: (text: string) => void;
}

/** A new chat: the agent's tile and what it was trained to do. */
export function EmptyChat({ agent, onPick }: EmptyChatProps) {
  const suggestions = suggestionsFor(agent.manifest);
  return (
    <div className="flex min-h-[52vh] animate-rise flex-col items-center justify-center gap-6">
      <AgentAvatar name={agent.name} size="lg" />
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
