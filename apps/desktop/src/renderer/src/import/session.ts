import { create } from 'zustand';
import { architect } from '../api/client';
import { navigate, paths } from '../lib/router';

interface ImportSession {
  /** The package file or folder the user chose, which the import screen checks. */
  path: string | null;
  choose: (path: string) => void;
}

export const useImportSession = create<ImportSession>()((set) => ({
  path: null,
  choose: (path) => set({ path }),
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
