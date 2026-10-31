import { api } from '../api/client';
import { graduatesApi } from '../api/graduates';
import { toError, useQuery } from '../api/query';
import { rowKey, type ModelRow } from './registry';

export const REGISTRY_KEY = 'models:registry';

/**
 * Every version of every agent on this computer, each with the report card its own final test
 * left. A card that can't be read stays with its row as the reason, so the row still shows.
 */
export async function loadRegistry(): Promise<ModelRow[]> {
  const agents = await api.graduates();
  const listed = await Promise.all(
    agents.map(async (agent) => ({ agent, versions: await graduatesApi.versions(agent.id) })),
  );
  return Promise.all(
    listed.flatMap(({ agent, versions }) =>
      versions.map(async (version): Promise<ModelRow> => {
        const row = { key: rowKey(agent.id, version.version), agent, version };
        if (version.manifest.evidence.files?.report === undefined) {
          return { ...row, report: null, reportError: null };
        }
        try {
          const report = await graduatesApi.report(agent.id, version.version);
          return { ...row, report, reportError: null };
        } catch (error) {
          return { ...row, report: null, reportError: toError(error) };
        }
      }),
    ),
  );
}

/** The registry, read again each time the place opens, since runs and imports add to it. */
export const useRegistry = () => useQuery(REGISTRY_KEY, loadRegistry, { refreshOnMount: true });

/** The registry row of the version a run made, once that version is on this computer. */
export function versionOfRun(rows: readonly ModelRow[], runId: string): ModelRow | undefined {
  return rows.find((row) => row.version.runId === runId);
}
