import type { FieldExportRecord } from '@architect/shared';
import { create } from 'zustand';
import { useSettings } from '../api/hooks';

/** A field's latest export, and whether its folder can be read now or must be chosen again. */
export interface FieldExport extends FieldExportRecord {
  ready: boolean;
}

interface SessionExports {
  /** Exports written since Architect started, by job id. */
  written: Readonly<Record<string, FieldExportRecord>>;
  /** Folders the person chose since Architect started. */
  chosen: readonly string[];
  record: (written: Omit<FieldExportRecord, 'at'>) => void;
  choose: (dir: string) => void;
}

/**
 * What this session knows of exports. A folder is opened only once the person chose it since
 * Architect started, so an export recorded before a restart waits until it is chosen again.
 */
export const useSessionExports = create<SessionExports>((set) => ({
  written: {},
  chosen: [],
  record: (written) =>
    set((state) => ({
      written: {
        ...state.written,
        [written.jobId]: { ...written, at: new Date().toISOString() },
      },
      chosen: [...state.chosen, written.dir],
    })),
  choose: (dir) => set((state) => ({ chosen: [...state.chosen, dir] })),
}));

/**
 * Each field's latest export, newest first: the ones recorded in settings (which survive a
 * restart) and the ones written this session, each ready when its folder was chosen this session.
 */
export function latestExports(
  recorded: readonly FieldExportRecord[],
  session: Pick<SessionExports, 'written' | 'chosen'>,
): FieldExport[] {
  const latest = new Map<string, FieldExportRecord>();
  for (const item of [...recorded, ...Object.values(session.written)]) {
    const known = latest.get(item.jobId);
    if (known === undefined || known.at <= item.at) latest.set(item.jobId, item);
  }
  const chosen = new Set(session.chosen);
  return [...latest.values()]
    .map((item) => ({ ...item, ready: chosen.has(item.dir) }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Each field's latest export, newest first. */
export function useFieldExports(): FieldExport[] {
  const recorded = useSettings().data?.fieldExports;
  const written = useSessionExports((state) => state.written);
  const chosen = useSessionExports((state) => state.chosen);
  return latestExports(recorded ?? [], { written, chosen });
}
