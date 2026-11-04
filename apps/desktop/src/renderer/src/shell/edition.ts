import type { Edition } from '@architect/shared';
import { WORDS, type Words } from '@architect/ui';
import { useSettings } from '../api/hooks';
import type { Route } from '../lib/router';
import { PLACES, placeOf, WSP_PLACES, type Place } from './places';

/**
 * Each edition's name, as the shell shows it, and what it is for in one line (decisions 076 and
 * 109). Architect WSP is experimental, and says so wherever its name is offered.
 */
export const EDITIONS: Record<Edition, { name: string; says: string; experimental?: true }> = {
  personal: { name: 'Architect', says: 'Teach an agent one job' },
  lab: { name: 'Architect Lab', says: 'R&D for an entire field' },
  wsp: { name: 'Architect WSP', says: "Edit a model's weights with programs", experimental: true },
};

/** The places an edition shows: the personal app has its agents and none of the Lab's places. */
export function placesOf(edition: Edition): readonly Place[] {
  if (edition === 'lab') return PLACES;
  if (edition === 'wsp') return WSP_PLACES;
  return [];
}

/**
 * A route the personal edition doesn't have: a Lab place other than home, which both editions
 * have (the Lab in one, the agents' home in the other), and a team's chat (decision 100).
 */
export function isLabOnly(route: Route): boolean {
  if (route.name === 'team-chat') return true;
  const place = placeOf(route);
  return place !== null && place !== 'lab' && place !== 'wsp';
}

/** A route of Architect WSP's own: a new experiment or one experiment (decision 109). */
export function isWspOnly(route: Route): boolean {
  return placeOf(route) === 'wsp';
}

/** The routes Architect WSP shares with the others: its home, the welcome and a wrong address. */
const WSP_SHARED: ReadonlySet<Route['name']> = new Set(['home', 'welcome', 'not-found']);

/**
 * Whether an edition has a route. The personal app has neither the Lab's places nor WSP's; the
 * Lab has everything but WSP's; WSP has its own experiments and none of the agents, the flow or
 * the Lab's places. A route an edition lacks is sent home.
 */
export function inEdition(route: Route, edition: Edition): boolean {
  if (edition === 'wsp') return WSP_SHARED.has(route.name) || isWspOnly(route);
  if (isWspOnly(route)) return false;
  return edition === 'lab' || !isLabOnly(route);
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

/**
 * The words a shared screen uses for its parts in this edition (`WORDS` in @architect/ui): the
 * personal edition's until the settings have loaded, and the Lab's in Architect WSP.
 */
export function useWords(): Words {
  const edition = useEdition();
  return WORDS[edition === 'wsp' ? 'lab' : (edition ?? 'personal')];
}
