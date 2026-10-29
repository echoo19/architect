import type { PackageResource } from '@architect/shared';
import { capitalized } from '../lib/names';

/**
 * What a package's folder is called on screen: by what it holds, not by the name its manifest
 * gives it, so a person is asked for "the records folder" and never for `data/`.
 */
export function folderName(resource: Pick<PackageResource, 'name'>): string {
  switch (resource.name) {
    case 'data':
      return 'Records folder';
    case 'output':
      return 'Output folder';
    default:
      return `${capitalized(resource.name)} folder`;
  }
}
