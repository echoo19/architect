import { create } from 'zustand';
import { architect } from '../api/client';
import { graduatesApi } from '../api/graduates';
import { navigate, paths } from '../lib/router';

/**
 * Where an import comes from: a package the user chose, or a repository on Hugging Face. A
 * package that comes with Architect arrives with the folders it is already set to use.
 */
export type ImportSource =
  | { kind: 'file'; path: string; bindings?: Readonly<Record<string, string>> }
  | { kind: 'hub'; started: number };

interface ImportSession {
  source: ImportSource | null;
  /** Starts an import of a package, with the folders already chosen for it, if there are any. */
  choose: (path: string, bindings?: Readonly<Record<string, string>>) => void;
  /** Starts an install from Hugging Face afresh. */
  fromHub: () => void;
}

export const useImportSession = create<ImportSession>()((set) => ({
  source: null,
  choose: (path, bindings) =>
    set({ source: { kind: 'file', path, ...(bindings === undefined ? {} : { bindings }) } }),
  fromHub: () => set({ source: { kind: 'hub', started: Date.now() } }),
}));

/** The file dialog's filter for packages, which are ZIP files named `.architect.zip`. */
const PACKAGE_FILTER = { name: 'Agent package', extensions: ['zip'] };

/**
 * Asks for a package (a `.architect.zip`, or an exported folder when `folder` is set) and opens
 * the import screen with it. Closing the dialog changes nothing.
 */
export async function chooseImport(folder = false): Promise<void> {
  const [path] = await architect().files.pick(
    folder
      ? { title: 'Choose an exported agent folder', directory: true }
      : { title: 'Choose an agent package', filters: [PACKAGE_FILTER] },
  );
  if (!path) return;
  useImportSession.getState().choose(path);
  navigate(paths.importAgent());
}

/**
 * Opens the import screen on the ready-made agent that comes with Architect, with `data/` already
 * chosen as this computer's copy of its data. The copy is made the first time and kept after;
 * the rest is an import like any other. Fails, with the reason, if the copy can't be made.
 */
export async function openSampleAgent(): Promise<void> {
  const sample = await graduatesApi.prepareSampleAgent();
  useImportSession.getState().choose(sample.package, { data: sample.data });
  navigate(paths.importAgent());
}

/** Opens the import screen on a repository to install from Hugging Face. */
export function chooseFromHub(): void {
  useImportSession.getState().fromHub();
  navigate(paths.importAgent());
}
