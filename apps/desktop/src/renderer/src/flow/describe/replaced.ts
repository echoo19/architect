import type { ReplacedModel } from '@architect/shared';
import { shortModelName } from '../../lib/names';
import { localModelName } from '../../settings/models/connections';

/** One replaced model in a sentence, named as the rest of the app names it. */
function sentenceOf({ role, from, to }: ReplacedModel): string {
  switch (role) {
    case 'mentor':
      return `${shortModelName(from)} isn't connected here, so ${shortModelName(to ?? '')} teaches.`;
    case 'student':
      return `${localModelName(from)} doesn't run on this computer, so the agent uses ${localModelName(to ?? '')}.`;
    case 'hosted':
      return to === null
        ? `${from} isn't connected here, so it practices on this computer.`
        : `${from} isn't connected here, so it practices on ${to}.`;
  }
}

/**
 * What an imported job file's toast says about the models it couldn't keep (decision 094): each
 * one the file named that isn't connected here, and what the job uses instead.
 */
export function replacedText(replaced: readonly ReplacedModel[]): string {
  return replaced.map(sentenceOf).join(' ');
}
