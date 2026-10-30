import { Boxes, Cpu, FlaskConical, LayoutGrid, Library, type LucideIcon } from 'lucide-react';
import { paths, type Route } from '../lib/router';

/** Architect's places, in the sidebar's order (docs/PLATFORM.md). */
export type PlaceId = 'lab' | 'fields' | 'experiments' | 'models' | 'compute';

export interface Place {
  id: PlaceId;
  label: string;
  Icon: LucideIcon;
  path: string;
  /** More words the command palette finds it by. */
  keywords: string[];
}

export const PLACES: readonly Place[] = [
  {
    id: 'lab',
    label: 'Lab',
    Icon: LayoutGrid,
    path: paths.home(),
    keywords: ['home', 'running', 'needs you', 'spend'],
  },
  {
    id: 'fields',
    label: 'Fields',
    Icon: Library,
    path: paths.fields(),
    keywords: ['organizations', 'academies', 'skills'],
  },
  {
    id: 'experiments',
    label: 'Experiments',
    Icon: FlaskConical,
    path: paths.experiments(),
    keywords: ['comparisons', 'arms', 'seeds'],
  },
  {
    id: 'models',
    label: 'Models',
    Icon: Boxes,
    path: paths.models(),
    keywords: ['registry', 'versions', 'agents'],
  },
  {
    id: 'compute',
    label: 'Compute',
    Icon: Cpu,
    path: paths.compute(),
    keywords: ['training', 'cluster', 'gpu'],
  },
];

/** The place a route belongs to, for the sidebar's selected row; none for a chat or the flow. */
export function placeOf(route: Route): PlaceId | null {
  switch (route.name) {
    case 'home':
      return 'lab';
    case 'fields':
    case 'field':
      return 'fields';
    case 'experiments':
    case 'experiment-new':
    case 'experiment':
      return 'experiments';
    case 'models':
      return 'models';
    case 'compute':
      return 'compute';
    default:
      return null;
  }
}
