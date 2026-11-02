import { useCallback } from 'react';
import type { ModelConfigRead, ModelConfigSource, TrainingPlan } from '@architect/shared';
import { create } from 'zustand';
import type { PlanSettings } from './model';

/** What a plan was left at: the model read, where it came from, and the settings it is sized with. */
export interface KeptPlan {
  settings: PlanSettings;
  read: ModelConfigRead | null;
  plan: TrainingPlan | null;
  from: ModelConfigSource['kind'];
  repo: string;
  revision: string;
  file: string | null;
}

interface KeptPlans {
  /** By plan: Compute on its own, or for a field and its model. */
  plans: Readonly<Record<string, Partial<KeptPlan>>>;
  keep: <K extends keyof KeptPlan>(plan: string, part: K, value: KeptPlan[K]) => void;
}

/**
 * Plans kept while Architect runs, so leaving Compute and coming back finds the plan as it was
 * left rather than empty.
 */
const useKeptPlans = create<KeptPlans>((set) => ({
  plans: {},
  keep: (plan, part, value) =>
    set((state) => ({
      plans: { ...state.plans, [plan]: { ...state.plans[plan], [part]: value } },
    })),
}));

/** Which plan a Compute page shows: its own, or a field's for one of its models. */
export const planKey = (jobId: string | undefined, model: string | undefined) =>
  jobId === undefined ? 'compute' : `${jobId}/${model ?? ''}`;

/** One part of a kept plan, like `useState`, starting from `initial` until something is kept. */
export function useKept<K extends keyof KeptPlan>(
  plan: string,
  part: K,
  initial: KeptPlan[K],
): [KeptPlan[K], (value: KeptPlan[K]) => void] {
  const kept = useKeptPlans((state) => state.plans[plan]?.[part]);
  const keep = useKeptPlans((state) => state.keep);
  const set = useCallback((value: KeptPlan[K]) => keep(plan, part, value), [keep, plan, part]);
  return [kept === undefined ? initial : (kept as KeptPlan[K]), set];
}
