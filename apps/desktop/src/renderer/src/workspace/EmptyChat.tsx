import type { GraduateSummary } from '@architect/shared';
import { AgentAvatar, Heading, Reveal } from '@architect/ui';
import { useVersionReport } from '../api/graduates';
import { useJob } from '../api/hooks';
import { certificateSentence } from '../flow/report/certificate-words';
import { suggestionsFor } from './labels';

export interface EmptyChatProps {
  agent: GraduateSummary;
  /** Puts a suggestion in the composer for the reader to finish and send. */
  onPick: (text: string) => void;
}

/**
 * A new chat: the agent and a few ways to start, drawn from what it was trained to do. A certified
 * agent says when it answers and when it hands a request to a person (decision 077).
 */
export function EmptyChat({ agent, onPick }: EmptyChatProps) {
  const job = useJob(agent.manifest.jobId);
  const certificate = useVersionReport(agent).data?.certificate;
  // Wait for the job, so the suggestions don't change under the pointer when it arrives.
  const suggestions =
    job.status === 'loading' ? [] : suggestionsFor(agent.manifest, job.data?.taskTypes);
  return (
    <Reveal className="flex min-h-[52vh] flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-3">
        <AgentAvatar name={agent.name} size="lg" />
        <Heading as="h2" size="title">
          {agent.name}
        </Heading>
        {certificate?.issued === true && (
          <p className="m-0 max-w-[520px] text-center text-ui text-pretty">
            {certificateSentence(certificate, agent.name)}
          </p>
        )}
      </div>
      {suggestions.length > 0 && (
        <div
          role="group"
          aria-label={`Things to ask ${agent.name}`}
          className="flex flex-wrap justify-center gap-2 text-ui"
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPick(suggestion)}
              className="h-10 rounded-control px-4 text-fg transition-colors duration-150 shadow-edge-strong"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </Reveal>
  );
}
