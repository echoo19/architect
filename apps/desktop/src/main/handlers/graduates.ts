import { HubError } from '@architect/engine';
import {
  BindRequestSchema,
  CodedError,
  ExportPartRequestSchema,
  ExportRequestSchema,
  HubInstallRequestSchema,
  ImportRequestSchema,
  PackageError,
  PublishRequestSchema,
  type BindRequest,
  type GraduateSummary,
  type HubInstallRequest,
  type ImportRequest,
} from '@architect/shared';
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
const version = z.number().int().positive();

/** What to do about a repository whose commit holds no package, said as a Hub hint is. */
const NOT_A_PACKAGE_HINT = 'Check the repository and the commit.';

/**
 * A Hugging Face failure with what to do about it in one message: only the message crosses to
 * the renderer, and the hint is the way out. A commit with no package gets one too, and keeps its
 * code, so a screen can say in its own words that it isn't an agent.
 */
async function withHubHint<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof HubError && error.hint) {
      throw new Error(`${error.message} ${error.hint}`, { cause: error });
    }
    if (error instanceof PackageError && error.code === 'not_a_package') {
      throw new CodedError('not_a_package', `${error.message} ${NOT_A_PACKAGE_HINT}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** Folders named in a request must be ones the user picked, like every other path. */
function checkedBindings<T extends BindRequest | ImportRequest | HubInstallRequest>(
  picked: PickedPaths,
  request: T,
): T {
  if (request.bindings === undefined) return request;
  return {
    ...request,
    bindings: Object.fromEntries(
      Object.entries(request.bindings).map(([name, folder]) => [name, picked.check(folder)]),
    ),
  };
}

/**
 * Graduates live in the engine, and the workspace follows: a graduate's active version is opened
 * in the agent host once it is accepted, imported, promoted, rolled back or rebound, and the
 * graduate is closed before it is removed. Installations are rows in the database both hosts
 * share, so the agent host reads a changed write mode on its next write. Every path the renderer
 * hands over must be one the user picked in a file dialog.
 */
export function registerGraduateHandlers(
  router: IpcRouter,
  call: EngineCall,
  workspace: GraduateWorkspace,
  picked: PickedPaths,
): void {
  /** Opens the graduate's active version again, after something changed what it runs. */
  const reopen = async (graduateId: string): Promise<void> => {
    const graduate = (await call((api) => api.graduates.list())).find(
      (listed) => listed.id === graduateId,
    );
    if (graduate) await workspace.open(graduate);
  };

  router.registerHandlers(
    'graduates',
    {
      list: () => call((api) => api.graduates.list()),
      accept: async (runId) => {
        const graduate = await call((api) => api.graduates.accept(runId));
        await workspace.open(graduate);
        return graduate;
      },
      versions: (graduateId) => call((api) => api.graduates.versions(graduateId)),
      history: (graduateId) => call((api) => api.graduates.history(graduateId)),
      report: (graduateId, number) => call((api) => api.graduates.report(graduateId, number)),
      acceptVersion: (graduateId, number) =>
        call((api) => api.graduates.acceptVersion(graduateId, number)),
      rejectVersion: (graduateId, number) =>
        call((api) => api.graduates.rejectVersion(graduateId, number)),
      promote: async (graduateId, number) => {
        const graduate = await call((api) => api.graduates.promote(graduateId, number));
        await workspace.open(graduate);
        return graduate;
      },
      rollback: async (graduateId, number) => {
        const graduate = await call((api) => api.graduates.rollback(graduateId, number));
        await workspace.open(graduate);
        return graduate;
      },
      installation: (graduateId) => call((api) => api.graduates.installation(graduateId)),
      bind: async (graduateId, request) => {
        const checked = checkedBindings(picked, request);
        const installation = await call((api) => api.graduates.bind(graduateId, checked));
        await reopen(graduateId);
        return installation;
      },
      verify: async (graduateId, options) => {
        const installation = await call((api) => api.graduates.verify(graduateId, options));
        await reopen(graduateId);
        return installation;
      },
      reviewExport: (graduateId, number, include) =>
        call((api) => api.graduates.reviewExport(graduateId, number, include)),
      exportPackage: (graduateId, request) => {
        const directory = picked.check(request.directory);
        return call((api) => api.graduates.exportPackage(graduateId, { ...request, directory }));
      },
      exportFolder: (graduateId, directory) => {
        const chosen = picked.check(directory);
        return call((api) => api.graduates.exportFolder(graduateId, chosen));
      },
      exportPart: (graduateId, request) => {
        const directory = picked.check(request.directory);
        return call((api) => api.graduates.exportPart(graduateId, { ...request, directory }));
      },
      inspectPackage: (path) => {
        const chosen = picked.check(path);
        return call((api) => api.graduates.inspectPackage(chosen));
      },
      previewImport: (path) => {
        const chosen = picked.check(path);
        return call((api) => api.graduates.previewImport(chosen));
      },
      importPackage: async (path, request) => {
        const chosen = picked.check(path);
        const checked = request === undefined ? undefined : checkedBindings(picked, request);
        const result = await call((api) => api.graduates.importPackage(chosen, checked));
        await workspace.open(result.graduate);
        return result;
      },
      importFolder: async (path) => {
        const chosen = picked.check(path);
        const graduate = await call((api) => api.graduates.importFolder(chosen));
        await workspace.open(graduate);
        return graduate;
      },
      installFromHub: async (source, request) => {
        const checked = request === undefined ? undefined : checkedBindings(picked, request);
        const result = await withHubHint(
          call((api) => api.graduates.installFromHub(source, checked)),
        );
        await workspace.open(result.graduate);
        return result;
      },
      hasSampleAgent: () => call((api) => api.graduates.hasSampleAgent()),
      prepareSampleAgent: async () => {
        const sample = await call((api) => api.graduates.prepareSampleAgent());
        // Files Architect ships and keeps itself: the import that follows may read them as it
        // reads what the user chose, and nothing else comes with them.
        picked.add([sample.package], 'files');
        picked.add([sample.data], 'folders');
        return sample;
      },
      reviewPublication: (graduateId, request) =>
        call((api) => api.graduates.reviewPublication(graduateId, request)),
      publish: (graduateId, request) =>
        withHubHint(call((api) => api.graduates.publish(graduateId, request))),
      publications: (graduateId) => call((api) => api.graduates.publications(graduateId)),
      remove: async (graduateId) => {
        await workspace.close(graduateId);
        await call((api) => api.graduates.remove(graduateId));
      },
      settings: (graduateId) => call((api) => api.graduates.settings(graduateId)),
      updateSettings: (graduateId, patch) =>
        call((api) => api.graduates.updateSettings(graduateId, patch)),
    },
    {
      report: z.union([z.tuple([text]), z.tuple([text, version])]),
      acceptVersion: z.tuple([text, version]),
      rejectVersion: z.tuple([text, version]),
      promote: z.tuple([text, version]),
      rollback: z.tuple([text, version]),
      bind: z.tuple([text, BindRequestSchema]),
      exportPackage: z.tuple([text, ExportRequestSchema]),
      exportFolder: z.tuple([text, text]),
      exportPart: z.tuple([text, ExportPartRequestSchema]),
      inspectPackage: z.tuple([text]),
      previewImport: z.tuple([text]),
      importPackage: z.union([z.tuple([text]), z.tuple([text, ImportRequestSchema])]),
      importFolder: z.tuple([text]),
      installFromHub: z.union([z.tuple([text]), z.tuple([text, HubInstallRequestSchema])]),
      reviewPublication: z.tuple([text, PublishRequestSchema]),
      publish: z.tuple([text, PublishRequestSchema]),
      publications: z.tuple([text]),
    },
  );
}
