import { HubRepositorySchema } from '@architect/shared';

/** How the command line and the docs name a model repository on the Hub. */
export const HUB_SCHEME = 'hf://';

/** Why a repository name can't be used, or null when it can. */
export function repositoryProblem(repository: string): string | null {
  const checked = HubRepositorySchema.safeParse(repository);
  return checked.success
    ? null
    : `"${repository}" ${checked.error.issues[0]?.message ?? 'is not a repository name'}`;
}

/** The repository an `hf://owner/name` source names, or null when the text isn't one. */
export function hubSource(text: string): string | null {
  if (!text.startsWith(HUB_SCHEME)) return null;
  const repository = text.slice(HUB_SCHEME.length).replace(/\/+$/, '');
  const problem = repositoryProblem(repository);
  if (problem) throw new Error(`${problem}. Write it as ${HUB_SCHEME}owner/name.`);
  return repository;
}

/** A repository's page on the Hub, at a commit when one is given. */
export function repositoryUrl(endpoint: string, repository: string, revision?: string): string {
  const base = `${endpoint.replace(/\/+$/, '')}/${repository}`;
  return revision === undefined ? base : `${base}/tree/${revision}`;
}
