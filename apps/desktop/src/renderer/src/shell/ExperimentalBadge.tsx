import { Badge } from '@architect/ui';
import type { Edition } from '@architect/shared';
import { EDITIONS } from './edition';

/** The chip after an experimental edition's name, wherever the name is offered or shown. */
export function ExperimentalBadge({ edition }: { edition: Edition }) {
  if (!EDITIONS[edition].experimental) return null;
  return <Badge size="sm">Experimental</Badge>;
}
