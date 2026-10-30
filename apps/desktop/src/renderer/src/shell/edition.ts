import type { Edition } from '@architect/shared';
import { useSettings } from '../api/hooks';
import type { Route } from '../lib/router';
import { PLACES, placeOf, type Place } from './places';

/** Each edition's name, as the shell shows it, and what it is for in one line (decision 076). */
export const EDITIONS: Record<Edition, { name: string; says: string }> = {
  personal: { name: 'Architect', says: 'Teach an agent one job' },
  lab: { name: 'Architect Lab', says: 'Fields, experiments, models and compute' },
};

/** The places an edition shows: the personal app has its agents and none of the Lab's places. */
export function placesOf(edition: Edition): readonly Place[] {
  return edition === 'lab' ? PLACES : [];
}

/**
 * A route the personal edition doesn't have: a Lab place other than home, which both editions
 * have (the Lab in one, the agents' home in the other).
 */
export function isLabOnly(route: Route): boolean {
  const place = placeOf(route);
  return place !== null && place !== 'lab';
}

/** The edition in the settings; null until they have loaded. */
export function useEdition(): Edition | null {
  return useSettings().data?.edition ?? null;
}
