import type { GraduateSummary } from '@architect/shared';
import { z } from 'zod';
import type { PickedPaths } from '../files/picked';
import type { IpcRouter } from '../ipc/router';
import type { EngineCall } from './engine';

/** The workspace's side of a graduate's life. Neither method throws. */
export interface GraduateWorkspace {
  open(graduate: GraduateSummary): Promise<void>;
  close(graduateId: string): Promise<void>;
}

const text = z.string().min(1);

/**
 * Graduates live in the engine, and the workspace follows: a graduate is opened in the agent
 * host once it is accepted or imported, and closed before it is removed. Settings are rows in
 * the database both hosts share, so the agent host reads a changed write mode on its next write.
 */
export function registerGraduateHandlers(
  router: IpcRouter,
  call: EngineCall,
  workspace: GraduateWorkspace,
  picked: PickedPaths,
): void {
  router.registerHandlers(
    'graduates',
    {
      list: () => call((api) => api.graduates.list()),
      accept: async (runId) => {
        const graduate = await call((api) => api.graduates.accept(runId));
        await workspace.open(graduate);
        return graduate;
      },
      exportFolder: (graduateId, folder) => {
        const chosen = picked.check(folder);
        return call((api) => api.graduates.exportFolder(graduateId, chosen));
      },
      importFolder: async (folder) => {
        const chosen = picked.check(folder);
        const graduate = await call((api) => api.graduates.importFolder(chosen));
        await workspace.open(graduate);
        return graduate;
      },
      remove: async (graduateId) => {
        await workspace.close(graduateId);
        await call((api) => api.graduates.remove(graduateId));
      },
      settings: (graduateId) => call((api) => api.graduates.settings(graduateId)),
      updateSettings: (graduateId, patch) =>
        call((api) => api.graduates.updateSettings(graduateId, patch)),
    },
    {
      exportFolder: z.tuple([text, text]),
      importFolder: z.tuple([text]),
    },
  );
}
