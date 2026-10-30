import { useState } from 'react';
import type { Job } from '@architect/shared';
import { Disclosure, Input, Segmented, ToggleRow } from '@architect/ui';
import { Lock } from 'lucide-react';
import { modelNames } from '../names';
import { Group, InspectorRow, Issue, NumberField, PathField } from './fields';
import { FinalTestChoice } from './FinalTestChoice';
import type { FinalTestState } from './final-test';
import type { InspectorTabProps } from './inspector-tabs';
import { tasksText } from './task-plan';
import { TasksTab } from './TasksTab';
import { TYPING_PAUSE_MS } from './use-job-editor';
import { tasksSplit } from './validate';

const CHECKERS = [
  { value: 'builtin', label: 'Answer line' },
  { value: 'module', label: 'Checker file' },
] as const;

interface EvaluationTabProps extends InspectorTabProps {
  /** How many tasks the job holds, when known: once it holds any, they were split. */
  taskCount: number | null;
  finalTest: FinalTestState;
}

/**
 * How the agent is measured: when it is ready, where and under which seeds the final test runs,
 * how its tasks are split, which organizations stay sealed, how answers are graded, and the tasks.
 */
export function EvaluationTab({ editor, change, taskCount, finalTest }: EvaluationTabProps) {
  const { job, issues } = editor;
  const { p95LatencyMs } = job.requirements;
  const typed = (what: string, recipe: (current: Job) => Job) =>
    change(what, recipe, TYPING_PAUSE_MS);
  return (
    <div className="flex flex-col gap-6">
      <Group title="Ready when">
        <NumberField
          label="New tasks right"
          unit="%"
          value={Math.round(job.requirements.passRate * 100)}
          issue={issues['requirements.passRate']}
          onChange={(percent) =>
            typed('Target', (current) => ({
              ...current,
              requirements: { ...current.requirements, passRate: percent / 100 },
            }))
          }
        />
        <ToggleRow
          label="Answer time limit"
          type="Seconds"
          className="border-t border-line"
          checked={p95LatencyMs !== undefined}
          onCheckedChange={(on) =>
            change('Answer time limit', (current) => ({
              ...current,
              requirements: on
                ? { ...current.requirements, p95LatencyMs: 8000 }
                : { passRate: current.requirements.passRate },
            }))
          }
        />
        {p95LatencyMs !== undefined && (
          <NumberField
            label="Slowest answer"
            unit="seconds"
            value={p95LatencyMs / 1000}
            issue={issues['requirements.p95LatencyMs']}
            onChange={(seconds) =>
              typed('Answer time limit', (current) => ({
                ...current,
                requirements: {
                  ...current.requirements,
                  p95LatencyMs: Math.round(seconds * 1000),
                },
              }))
            }
          />
        )}
      </Group>
      <div className="flex flex-col">
        <FinalTestChoice
          job={job}
          place={finalTest.place}
          onPlaceChange={finalTest.onPlaceChange}
          hosted={finalTest.hosted}
        />
        <SeedsField editor={editor} change={change} />
      </div>
      <Sets editor={editor} change={change} taskCount={taskCount} />
      <Organizations job={job} />
      <Group title="Grading">
        <InspectorRow label="Graded by">
          <Segmented
            aria-label="How answers are graded"
            options={CHECKERS}
            value={job.checker.kind}
            onValueChange={(kind) =>
              change('Grading', (current) => ({
                ...current,
                checker: kind === 'builtin' ? { kind } : { kind, path: '' },
              }))
            }
          />
        </InspectorRow>
        {job.checker.kind === 'module' && (
          <>
            <PathField
              label="Checker file"
              kind="file"
              extensions={['js', 'mjs']}
              path={job.checker.path}
              issue={issues['checker.path']}
              onPick={(path) =>
                change('Checker file', (current) => ({
                  ...current,
                  checker: { kind: 'module', path },
                }))
              }
            />
            <p className="m-0 text-small text-pretty">
              A file you choose is copied into the job when it saves, so moving the original changes
              nothing.
            </p>
          </>
        )}
      </Group>
      <Disclosure label="Example tasks">
        <div className="pt-2">
          <TasksTab job={job} />
        </div>
      </Disclosure>
    </div>
  );
}

/** "11, 12, 13": the final test's seeds as typed, or nothing when the run picks its own. */
function seedsText(seeds: readonly number[] | undefined): string {
  return seeds === undefined ? '' : seeds.join(', ');
}

/** The seeds in a typed list, or null when one of them isn't a whole number from 0 up. */
export function parseSeeds(text: string): number[] | null {
  const parts = text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seeds = parts.map(Number);
  return seeds.every((seed) => Number.isInteger(seed) && seed >= 0) ? seeds : null;
}

/**
 * The final test's seeds, declared before any run: every final-test task is tried once under
 * each, and each try is kept apart. Left empty, the run picks one seed of its own.
 */
function SeedsField({ editor, change }: InspectorTabProps) {
  const { job, issues } = editor;
  const [text, setText] = useState(() => seedsText(job.evaluation.lockedTestSeeds));
  const [unreadable, setUnreadable] = useState(false);
  const error = unreadable
    ? 'Use whole numbers from 0, split by commas.'
    : issues['evaluation.lockedTestSeeds'];
  const label = 'Final test seeds';
  return (
    <InspectorRow label={label} error={error}>
      <Input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        placeholder="One, from the run"
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const seeds = parseSeeds(next);
          setUnreadable(seeds === null);
          if (seeds === null) return;
          change(
            label,
            (current) => {
              const { lockedTestSeeds: _before, ...evaluation } = current.evaluation;
              return {
                ...current,
                evaluation:
                  seeds.length === 0 ? evaluation : { ...evaluation, lockedTestSeeds: seeds },
              };
            },
            TYPING_PAUSE_MS,
          );
        }}
        className="h-9 w-40 tabular-nums"
      />
    </InspectorRow>
  );
}

/**
 * The practice, check and final-test sets and the seed that drew them. Once the tasks are split
 * they show what they are; nothing splits them again.
 */
function Sets({ editor, change, taskCount }: InspectorTabProps & { taskCount: number | null }) {
  const { job, issues } = editor;
  const { mentor } = modelNames(job);
  const { train, dev, test, calibration, seed } = job.splits;
  const splits = (patch: Partial<Job['splits']>) =>
    change(
      'Task sets',
      (current) => ({ ...current, splits: { ...current.splits, ...patch } }),
      TYPING_PAUSE_MS,
    );
  if (tasksSplit(taskCount)) {
    return (
      <Group title="Task sets">
        <InspectorRow label="Practice">
          <span className="text-ui tabular-nums">{tasksText(train)}</span>
        </InspectorRow>
        <InspectorRow label={`Check, ${mentor} sees only the score`}>
          <span className="text-ui tabular-nums">{tasksText(dev)}</span>
        </InspectorRow>
        <InspectorRow label="Final test, opened once">
          <span className="text-ui tabular-nums">{tasksText(test)}</span>
        </InspectorRow>
        {calibration > 0 && (
          <InspectorRow label="Set aside">
            <span className="text-ui tabular-nums">{tasksText(calibration)}</span>
          </InspectorRow>
        )}
        <InspectorRow
          label="Seed"
          note="The tasks were split when they were added, so the sets can't change now."
        >
          <span className="text-ui tabular-nums">{seed}</span>
        </InspectorRow>
      </Group>
    );
  }
  return (
    <Group title="Task sets">
      <NumberField
        label="Practice"
        unit="tasks"
        value={train}
        issue={issues['splits.train']}
        onChange={(value) => splits({ train: value })}
      />
      <NumberField
        label="Check"
        unit="tasks"
        value={dev}
        issue={issues['splits.dev']}
        onChange={(value) => splits({ dev: value })}
      />
      <NumberField
        label="Final test"
        unit="tasks"
        value={test}
        issue={issues['splits.test']}
        onChange={(value) => splits({ test: value })}
      />
      <NumberField
        label="Seed"
        value={seed}
        issue={issues['splits.seed']}
        onChange={(value) => splits({ seed: value })}
      />
      <Issue error={issues.splits} />
    </Group>
  );
}

/**
 * The organizations the job serves: those it practices on by name, and those sealed with the
 * final test only by their count, as every screen before the final test shows them.
 */
function Organizations({ job }: { job: Job }) {
  const orgs = job.organizations;
  if (orgs === undefined) return null;
  const { mentor } = modelNames(job);
  const practiced = orgs.filter((org) => org.role === 'train');
  // The library's copy of a job drops the ones it never trains on, so their count may be unknown.
  const sealed = orgs.length - practiced.length;
  return (
    <Group title="Organizations">
      {practiced.map((org) => (
        <InspectorRow key={org.id} label={org.name}>
          <span className="text-ui">Practiced</span>
        </InspectorRow>
      ))}
      <InspectorRow
        label={sealed === 0 ? 'Any it never trains on' : `${sealed} it never trains on`}
        note={`Kept with the final test. ${mentor} never sees them.`}
      >
        <span className="flex items-center gap-1.5 text-ui">
          <Lock size={14} strokeWidth={1.8} aria-hidden />
          Sealed
        </span>
      </InspectorRow>
    </Group>
  );
}
