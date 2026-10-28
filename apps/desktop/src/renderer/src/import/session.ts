import { create } from 'zustand';
import { architect } from '../api/client';
import { navigate, paths } from '../lib/router';

/** Where an import comes from: a package the user chose, or a repository on Hugging Face. */
export type ImportSource = { kind: 'file'; path: string } | { kind: 'hub'; started: number };

interface ImportSession {
  source: ImportSource | null;
  choose: (path: string) => void;
  /** Starts an install from Hugging Face afresh. */
  fromHub: () => void;
}

export const useImportSession = create<ImportSession>()((set) => ({
  source: null,
  choose: (path) => set({ source: { kind: 'file', path } }),
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

/** Opens the import screen on a repository to install from Hugging Face. */
export function chooseFromHub(): void {
  useImportSession.getState().fromHub();
  navigate(paths.importAgent());
}
