import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Job } from '@architect/shared';
import { toast } from '@architect/ui';
import { flowApi } from '../../api/client';
import { queryKeys } from '../../api/hooks';
import { setQueryData, toError } from '../../api/query';
import { validateJob, type JobIssues } from './validate';

/**
 * Where the last edit stands: saved, waiting for a pause in typing or for the save to finish,
 * or refused by the engine. An edit with issues waits until they are fixed.
 */
export type SaveStatus = 'saved' | 'saving' | 'failed';

export interface JobEditor {
  job: Job;
  issues: JobIssues;
  saveStatus: SaveStatus;
  /** Changes the job at once on screen; saves it when valid, after `quietMs` without changes. */
  change: (recipe: (job: Job) => Job, quietMs?: number) => void;
  /** Saves anything still waiting. Resolves with the saved job, or null if it can't be saved. */
  flush: () => Promise<Job | null>;
}

/** Whether two jobs grade the same way: the same built-in checker, or the same checker file. */
export function sameChecker(a: Job['checker'], b: Job['checker']): boolean {
  return a.kind === 'builtin' ? b.kind === 'builtin' : b.kind === 'module' && a.path === b.path;
}

/** Typing in a number field saves once the user pauses for this long. */
export const TYPING_PAUSE_MS = 500;

/**
 * Keeps the Define screen's copy of a job. Every edit shows immediately; valid edits are saved
 * with `jobs.save` one at a time, and the saved job replaces the cached one.
 */
export function useJobEditor(initial: Job, taskCount: number | null): JobEditor {
  const [job, setJob] = useState(initial);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const latest = useRef(initial);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<Job | null> | null>(null);
  const countRef = useRef(taskCount);
  useEffect(() => {
    countRef.current = taskCount;
  }, [taskCount]);

  const issues = useMemo(() => validateJob(job, taskCount), [job, taskCount]);

  const save = useCallback(async (): Promise<Job | null> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    const next = latest.current;
    if (!dirty.current) return next;
    if (Object.keys(validateJob(next, countRef.current)).length > 0) return null;

    dirty.current = false;
    const request = flowApi
      .saveJob(next)
      .then(
        (saved) => {
          setQueryData(queryKeys.job(saved.id), saved);
          // A checker file chosen from elsewhere is kept inside the job under a name of its own;
          // from now on the job points at that copy, so a later save never looks for the original.
          if (!sameChecker(saved.checker, next.checker)) {
            latest.current = { ...latest.current, checker: saved.checker };
            setJob((current) => ({ ...current, checker: saved.checker }));
          }
          if (!dirty.current) setSaveStatus('saved');
          return saved;
        },
        (error: unknown) => {
          dirty.current = true;
          setSaveStatus('failed');
          toast({
            tone: 'danger',
            title: "Couldn't save the job",
            description: toError(error).message,
          });
          return null;
        },
      )
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = request;
    return request;
  }, []);

  const change = useCallback(
    (recipe: (job: Job) => Job, quietMs = 0) => {
      const next = recipe(latest.current);
      latest.current = next;
      dirty.current = true;
      setJob(next);
      setSaveStatus('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), quietMs);
    },
    [save],
  );

  // Leaving the screen still saves the last edit.
  useEffect(
    () => () => {
      if (dirty.current) void save();
    },
    [save],
  );

  return { job, issues, saveStatus, change, flush: save };
}
