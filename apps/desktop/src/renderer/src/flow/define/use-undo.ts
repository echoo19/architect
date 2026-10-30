import { useCallback, useEffect, useRef } from 'react';
import type { Job } from '@architect/shared';
import { toast } from '@architect/ui';
import type { JobEditor } from './use-job-editor';

/** A change made in the inspector, in the editor's terms, named for the toast that follows it. */
export type NamedChange = (what: string, recipe: (job: Job) => Job, quietMs?: number) => void;

/**
 * The job with the settings a change touched put back as they were before it, and every other
 * setting as it is now. Settings are compared at the job's top level (the budget, the student),
 * so an undo never reaches a setting the change left alone.
 */
export function undone(current: Job, before: Job, after: Job): Job {
  const next: Record<string, unknown> = { ...current };
  const was = before as unknown as Record<string, unknown>;
  const is = after as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(is)])) {
    if (Object.is(was[key], is[key])) continue;
    if (key in was) next[key] = was[key];
    else delete next[key];
  }
  return next as unknown as Job;
}

/**
 * Changes through the editor that say, once each is saved, what was saved, with Undo. Edits made
 * in a row, such as typing, are one change: the toast comes when they are saved, and Undo puts
 * back what was there before the first. An edit that isn't valid yet waits, with its toast, until
 * it is put right and saved.
 */
export function useUndoableChange(editor: JobEditor): NamedChange {
  const latest = useRef(editor);
  useEffect(() => {
    latest.current = editor;
  });
  const pending = useRef<{ what: string; before: Job } | null>(null);

  const change = useCallback<NamedChange>((what, recipe, quietMs) => {
    const current = latest.current;
    pending.current = { what, before: pending.current?.before ?? current.job };
    current.change(recipe, quietMs);
  }, []);

  const { saveStatus, issues, job } = editor;
  useEffect(() => {
    const waiting = pending.current;
    if (waiting === null || saveStatus !== 'saved' || Object.keys(issues).length > 0) return;
    pending.current = null;
    const after = job;
    toast({
      key: 'define-change',
      title: `${waiting.what} saved`,
      action: {
        label: 'Undo',
        onClick: () => latest.current.change((now) => undone(now, waiting.before, after)),
      },
    });
  }, [saveStatus, issues, job]);

  return change;
}
