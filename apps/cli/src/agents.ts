import type { GraduateLibrary } from '@architect/engine/graduates';
import { slugify, type GraduateSummary } from '@architect/shared';
import { CliError } from './exit';

/** The name the command line knows an agent by: its name, lowercased with dashes. */
export function agentSlug(summary: Pick<GraduateSummary, 'name'>): string {
  return slugify(summary.name);
}

/**
 * The agent a person named: by its id, or by its name as `architect list` shows it. A name two
 * agents share is refused, with their ids, rather than guessed.
 */
export function resolveAgent(library: GraduateLibrary, named: string): GraduateSummary {
  return pickAgent(library.list(), named);
}

/** `resolveAgent` over agents already listed. */
export function pickAgent(agents: readonly GraduateSummary[], named: string): GraduateSummary {
  const byId = agents.find((agent) => agent.id === named);
  if (byId) return byId;
  const slug = slugify(named);
  const matches = agents.filter((agent) => agentSlug(agent) === slug);
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) {
    throw new CliError(
      'invalid_input',
      'ambiguous_agent',
      `${matches.length} agents are called ${named}: ${matches.map((agent) => agent.id).join(', ')}.`,
      'Name one by its id.',
    );
  }
  throw new CliError(
    'invalid_input',
    'unknown_agent',
    `There is no agent called ${named} here.`,
    '`architect list` shows the agents on this computer.',
  );
}
