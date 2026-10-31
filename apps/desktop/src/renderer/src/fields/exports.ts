import { create } from 'zustand';

/** A field export written in this session: the field, and the folder it went to. */
export interface FieldExport {
  jobId: string;
  name: string;
  dir: string;
  at: number;
}

interface FieldExports {
  /** Each field's latest export, by its job's id. */
  latest: Record<string, FieldExport>;
  record: (written: Omit<FieldExport, 'at'>) => void;
}

/**
 * The exports written since Architect started, so Compute can offer a field's latest one. Only
 * this session's: a folder is opened again only once the person chose it again.
 */
export const useFieldExports = create<FieldExports>((set) => ({
  latest: {},
  record: (written) =>
    set((state) => ({
      latest: { ...state.latest, [written.jobId]: { ...written, at: Date.now() } },
    })),
}));

/** The exports, newest first. */
export const newestFirst = (latest: Record<string, FieldExport>): FieldExport[] =>
  Object.values(latest).sort((a, b) => b.at - a.at);
