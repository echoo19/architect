import { useEffect, useRef } from 'react';
import {
  CorrectionSchema,
  ImprovementSchema,
  ImprovementStartSchema,
  RunEventSchema,
  TeachingOverviewSchema,
  type CorrectionRequest,
  type ImproveOptions,
  type RunStatus,
} from '@architect/shared';
import { z } from 'zod';
import { architect, read } from './client';
import { refreshAgent } from './graduates';
import { fetchQuery, useQuery } from './query';

/** Teach this and Improve agent: flagged answers, the lessons they become, and improvements. */
export const teachApi = {
  overview: (graduateId: string) =>
    read('teach.overview', TeachingOverviewSchema, architect().teach.overview(graduateId)),
  corrections: (graduateId: string) =>
    read('teach.list', z.array(CorrectionSchema), architect().teach.list(graduateId)),
  improvements: (graduateId: string) =>
    read(
      'teach.improvements',
      z.array(ImprovementSchema),
      architect().teach.improvements(graduateId),
    ),
  propose: (chatId: string, messageId: string, request: CorrectionRequest) =>
    read('teach.propose', CorrectionSchema, architect().teach.propose(chatId, messageId, request)),
  queue: (correctionId: string) =>
    read('teach.queue', CorrectionSchema, architect().teach.queue(correctionId)),
  discard: (correctionId: string) =>
    read('teach.discard', CorrectionSchema, architect().teach.discard(correctionId)),
  improve: (graduateId: string, options: ImproveOptions) =>
    read('teach.improve', ImprovementStartSchema, architect().teach.improve(graduateId, options)),
  shareCorrections: (graduateId: string, allowed: boolean) =>
    read(
      'teach.shareCorrections',
      TeachingOverviewSchema,
      architect().teach.shareCorrections(graduateId, allowed),
    ),
};

export const teachKeys = {
  overview: (graduateId: string) => `teaching:${graduateId}`,
  corrections: (graduateId: string) => `corrections:${graduateId}`,
  improvements: (graduateId: string) => `improvements:${graduateId}`,
};

export const useTeachingOverview = (graduateId: string) =>
  useQuery(teachKeys.overview(graduateId), () => teachApi.overview(graduateId));

export const useCorrections = (graduateId: string) =>
  useQuery(teachKeys.corrections(graduateId), () => teachApi.corrections(graduateId));

export const useImprovements = (graduateId: string) =>
  useQuery(teachKeys.improvements(graduateId), () => teachApi.improvements(graduateId));

/** Reads an agent's lessons, improvements and teaching overview again after one changed. */
export async function refreshTeaching(graduateId: string): Promise<void> {
  await Promise.all([
    fetchQuery(teachKeys.corrections(graduateId), () => teachApi.corrections(graduateId)),
    fetchQuery(teachKeys.improvements(graduateId), () => teachApi.improvements(graduateId)),
    fetchQuery(teachKeys.overview(graduateId), () => teachApi.overview(graduateId)),
  ]);
}

/**
 * Reads an agent's teaching again when a screen showing it opens, since an improvement may have
 * moved on, stopped or ended while it was closed.
 */
export function useFreshTeaching(graduateId: string): void {
  useEffect(() => {
    void refreshTeaching(graduateId);
  }, [graduateId]);
}

/**
 * Keeps what a screen shows of an agent's teaching current: when one of its improvements changes
 * status, or a new version of it is made, its lessons, improvements and versions are read again.
 */
export function useTeachingUpdates(graduateId: string, runIds: readonly string[]): void {
  const watched = runIds.join(',');
  const statuses = useRef(new Map<string, RunStatus>());
  useEffect(() => {
    const ours = new Set(watched.split(',').filter(Boolean));
    return architect().runs.onEvent((payload) => {
      const parsed = RunEventSchema.safeParse(payload);
      if (!parsed.success) return;
      const event = parsed.data;
      const changed =
        event.type === 'run.updated' &&
        ours.has(event.runId) &&
        statuses.current.get(event.runId) !== event.run.status;
      if (event.type === 'run.updated') statuses.current.set(event.runId, event.run.status);
      const made = event.type === 'graduate.ready' && event.graduateId === graduateId;
      if (!changed && !made) return;
      void refreshTeaching(graduateId);
      void refreshAgent(graduateId);
    });
  }, [graduateId, watched]);
}
