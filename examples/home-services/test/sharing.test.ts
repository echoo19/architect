import type { JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { expectedSlot, latestVersion, paramsOf } from './helpers';

/**
 * A harness that memorizes answers seen in training should score close to nothing on unseen
 * tasks (decision 018), so in version 2 no answer is right for more than three tasks of a type.
 * What counts as "the answer" is what an attempt has to work out: an invoice's total (its id
 * follows from the job named in the request), an overdue answer as the comparator reads it, and a
 * booking's date and start time.
 */

const MAX_TASKS_PER_ANSWER = 3;

/** JSON with object keys sorted and the comparator's unordered lists sorted. */
function canonical(value: JsonValue, setKeys: readonly string[]): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, setKeys)).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.keys(value)
    .sort()
    .map((key) => {
      const child = value[key] as JsonValue;
      const items = Array.isArray(child) && setKeys.includes(key);
      const text = items
        ? `[${child
            .map((item) => canonical(item, setKeys))
            .sort()
            .join(',')}]`
        : canonical(child, setKeys);
      return `${JSON.stringify(key)}:${text}`;
    });
  return `{${entries.join(',')}}`;
}

const ANSWERS: Record<string, (task: Task) => string> = {
  invoice: (task) => String(paramsOf(task).total_cents),
  overdue: (task) => {
    if (task.expected.kind !== 'answer') throw new Error(`${task.id} is not an answer task`);
    return canonical(task.expected.value, task.expected.compare.setKeys ?? []);
  },
  schedule: (task) => `${expectedSlot(task).date} ${expectedSlot(task).start_time}`,
};

describe('answers in version 2', () => {
  it.each(Object.keys(ANSWERS))('of %s tasks are each right for at most three tasks', (type) => {
    const answerOf = ANSWERS[type] as (task: Task) => string;
    const tasks = new Map<string, string[]>();
    for (const task of latestVersion.tasksOfType(type)) {
      const answer = answerOf(task);
      tasks.set(answer, [...(tasks.get(answer) ?? []), task.id]);
    }
    const shared = [...tasks].filter(([, ids]) => ids.length > MAX_TASKS_PER_ANSWER);
    expect(shared).toEqual([]);
  });

  it('take their ids from the task’s own record', () => {
    for (const task of latestVersion.tasksOfType('invoice')) {
      const { invoice_id, job_id } = paramsOf(task);
      expect(invoice_id, task.id).toBe(String(job_id).replace(/^W-/, 'INV-'));
    }
    for (const task of latestVersion.tasksOfType('schedule')) {
      const { booking_id, request_id } = paramsOf(task);
      expect(booking_id, task.id).toBe(String(request_id).replace(/^R-/, 'B-'));
    }
  });
});
