import type { Job } from '@architect/shared';
import { modelNames } from '../names';
import type { JobEditor } from './use-job-editor';
import type { NamedChange } from './use-undo';
import type { JobIssues } from './validate';

/** What each tab is given: the job as edited, and a change that is saved with Undo. */
export interface InspectorTabProps {
  editor: JobEditor;
  change: NamedChange;
}

/** The inspector's tabs on Define, in the order its strip lists them. */
export type DefineTab = 'teacher' | 'student' | 'teaching' | 'evaluation' | 'budget';

export const DEFINE_TABS: readonly DefineTab[] = [
  'teacher',
  'student',
  'teaching',
  'evaluation',
  'budget',
];

/** The panel's name, which the footer button that opens it carries too. */
export const INSPECTOR_NAME = 'Advanced settings';

/** A tab as the strip names it: the teacher's and the agent's tabs carry their models' names. */
export function tabLabel(tab: DefineTab, job: Job): string {
  const names = modelNames(job);
  switch (tab) {
    case 'teacher':
      return names.mentor;
    case 'student':
      return names.student;
    case 'teaching':
      return 'Teaching';
    case 'evaluation':
      return 'Evaluation';
    case 'budget':
      return 'Budget';
  }
}

/**
 * Which tab holds each field, the most specific path first: the rounds are a budget the teaching
 * spends, and the rule for keeping a change is part of teaching, while the final test's seeds are
 * part of evaluation.
 */
const TAB_OF_FIELD: readonly [string, DefineTab][] = [
  ['budget.maxRounds', 'teaching'],
  ['budget', 'budget'],
  ['mentor', 'teacher'],
  ['interventions', 'teaching'],
  ['startingHarness', 'teaching'],
  ['evaluation.lockedTestSeeds', 'evaluation'],
  ['evaluation', 'teaching'],
  ['student', 'student'],
  ['checker', 'evaluation'],
  ['requirements', 'evaluation'],
  ['splits', 'evaluation'],
];

/** The tab a field's control is on, or null for a field no tab holds. */
export function tabOfField(path: string): DefineTab | null {
  const match = TAB_OF_FIELD.find(([prefix]) => path === prefix || path.startsWith(`${prefix}.`));
  return match ? match[1] : null;
}

/** The first tab holding a problem, so Start training can open it. */
export function tabWithIssue(issues: JobIssues): DefineTab | null {
  for (const path of Object.keys(issues)) {
    const tab = tabOfField(path);
    if (tab) return tab;
  }
  return null;
}
