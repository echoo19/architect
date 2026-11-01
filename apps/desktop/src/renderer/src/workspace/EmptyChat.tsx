import type { GraduateSummary } from '@architect/shared';
import { AgentAvatar, Heading, Reveal } from '@architect/ui';
import { Flag } from 'lucide-react';
import { useVersionReport } from '../api/graduates';
import { useJob } from '../api/hooks';
import { certificateSentence } from '../flow/report/certificate-words';
import { namesInSentence, suggestionsFor } from './labels';

export interface EmptyChatProps {
  /** The agent that answers: in a team chat, the team's lead. */
  agent: GraduateSummary;
  /** In a team chat, the team's name and the teammates its lead may ask. */
  team?: { name: string; teammates: readonly GraduateSummary[] };
  /** The chat was started from Lessons to teach the agent something new, which it says how to. */
  toTeach?: boolean;
  /** Puts a suggestion in the composer for the reader to finish and send. */
  onPick: (text: string) => void;
}

/**
 * A new chat: the agent and a few ways to start, drawn from what it was trained to do. A certified
 * agent says when it answers and when it hands a request to a person (decision 077). A team shows
 * its agents and who answers; its answers are never certified, since no certificate covers an
 * agent asking another (decision 100), so a certified lead says so instead.
 */
export function EmptyChat({ agent, team, toTeach = false, onPick }: EmptyChatProps) {
  const job = useJob(agent.manifest.jobId);
  const certificate = useVersionReport(agent).data?.certificate;
  // Wait for the job, so the suggestions don't change under the pointer when it arrives.
  const suggestions =
    job.status === 'loading' ? [] : suggestionsFor(agent.manifest, job.data?.taskTypes);
  const certified = certificate?.issued === true;
  return (
    <Reveal className="flex min-h-[52vh] flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-3">
        {team ? (
          <div className="flex items-center gap-2">
            {[agent, ...team.teammates].map((member) => (
              <AgentAvatar key={member.id} name={member.name} size="lg" />
            ))}
          </div>
        ) : (
          <AgentAvatar name={agent.name} size="lg" />
        )}
        <Heading as="h2" size="title">
          {team?.name ?? agent.name}
        </Heading>
        {team && (
          <p className="m-0 max-w-[520px] text-center text-ui text-pretty">
            {agent.name} answers, and asks{' '}
            {namesInSentence(team.teammates.map((teammate) => teammate.name))} for their part.
            {certified && ` ${agent.name}'s certificate doesn't cover the team's answers.`}
          </p>
        )}
        {toTeach && (
          <p className="m-0 flex max-w-[520px] items-center gap-2 text-center text-ui text-pretty">
            <Flag size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
            Ask what it should learn, then flag its answer and say what it should have done.
          </p>
        )}
        {!team && certified && (
          <p className="m-0 max-w-[520px] text-center text-ui text-pretty">
            {certificateSentence(certificate, agent.name)}
          </p>
        )}
      </div>
      {suggestions.length > 0 && (
        <div
          role="group"
          aria-label={`Things to ask ${team?.name ?? agent.name}`}
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
