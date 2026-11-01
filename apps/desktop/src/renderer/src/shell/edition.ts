import type { Edition } from '@architect/shared';
import { useSettings } from '../api/hooks';
import type { Route } from '../lib/router';
import { PLACES, placeOf, type Place } from './places';

/** Each edition's name, as the shell shows it, and what it is for in one line (decision 076). */
export const EDITIONS: Record<Edition, { name: string; says: string }> = {
  personal: { name: 'Architect', says: 'Teach an agent one job' },
  lab: { name: 'Architect Lab', says: 'R&D for an entire field' },
};

/** The places an edition shows: the personal app has its agents and none of the Lab's places. */
export function placesOf(edition: Edition): readonly Place[] {
  return edition === 'lab' ? PLACES : [];
}

/**
 * A route the personal edition doesn't have: a Lab place other than home, which both editions
 * have (the Lab in one, the agents' home in the other), and a team's chat (decision 100).
 */
export function isLabOnly(route: Route): boolean {
  if (route.name === 'team-chat') return true;
  const place = placeOf(route);
  return place !== null && place !== 'lab';
}

/**
 * A route that reads teams (decision 100): a team's chat, or Models on its Teams tab. It shows
 * only once the edition is known to be the Lab, so the personal edition never asks for teams.
 */
export function readsTeams(route: Route): boolean {
  return route.name === 'team-chat' || (route.name === 'models' && route.tab === 'teams');
}

/** The edition in the settings; null until they have loaded. */
export function useEdition(): Edition | null {
  return useSettings().data?.edition ?? null;
}
