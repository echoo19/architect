import { useDraftStore } from '../flow/describe/draft-store';
import { navigate, paths } from '../lib/router';

/**
 * The one way a field starts, from Fields or the Lab: Describe, ready for its organizations'
 * folders.
 */
export function newField(): void {
  const { organizations, setOrganizations } = useDraftStore.getState();
  if (organizations === null) setOrganizations([]);
  navigate(paths.newAgent());
}
