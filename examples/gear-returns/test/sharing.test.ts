import type { JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { job, paramsOf } from './helpers';

/**
 * A harness that memorizes answers seen in training should score close to nothing on unseen
 * tasks (decision 018), so no answer is right for more than three tasks of a type. What counts as
 * "the answer" is what an attempt has to work out: a return's decision with every amount and
 * where the money goes (its id follows from the request), an order question's answer with its
 * lists as sets, and a pickup's carrier and date (its id follows from the return).
 */

const MAX_TASKS_PER_ANSWER = 3;

/** JSON with object keys sorted and lists sorted, the way the checker compares them. */
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).sort().join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key] as JsonValue)}`)
    .join(',')}}`;
}

const ANSWERS: Record<string, (task: Task) => string> = {
  refund: (task) => {
    const params = paramsOf(task);
    return canonical(
      Object.fromEntries(
        [
          'decision',
          'item_cents',
          'restocking_fee_cents',
          'return_shipping_cents',
          'shipping_refund_cents',
          'refund_cents',
          'refund_to',
        ].map((key) => [key, params[key] ?? null]),
      ),
    );
  },
  order: (task) => canonical(paramsOf(task).answer as JsonValue),
  pickup: (task) => `${paramsOf(task).carrier} ${paramsOf(task).pickup_date}`,
};

describe('answers', () => {
  it.each(Object.keys(ANSWERS))('of %s tasks are each right for at most three tasks', (type) => {
    const answerOf = ANSWERS[type] as (task: Task) => string;
    const tasks = new Map<string, string[]>();
    for (const task of job.tasksOfType(type)) {
      const answer = answerOf(task);
      tasks.set(answer, [...(tasks.get(answer) ?? []), task.id]);
    }
    expect([...tasks].filter(([, ids]) => ids.length > MAX_TASKS_PER_ANSWER)).toEqual([]);
  });

  it("take their ids from the task's own record", () => {
    for (const task of job.tasksOfType('refund')) {
      const request = task.meta?.request as { request_id: string };
      expect(paramsOf(task).return_id, task.id).toBe(request.request_id.replace(/^RQ-/, 'RT-'));
      expect(task.prompt, task.id).toContain(request.request_id);
    }
    for (const task of job.tasksOfType('pickup')) {
      const { pickup_id, return_id } = paramsOf(task);
      expect(pickup_id, task.id).toBe(String(return_id).replace(/^RT-/, 'PU-'));
      expect(task.prompt, task.id).toContain(String(return_id));
    }
  });

  it('come from returns still waiting for a pickup', () => {
    const booked = new Set(job.table('pickups.csv').map((row) => row.return_id));
    for (const task of job.tasksOfType('pickup')) {
      const id = String(paramsOf(task).return_id);
      expect(booked.has(id), task.id).toBe(false);
      const record = job.table('returns.csv').find((row) => row.return_id === id);
      expect(record?.decision, task.id).toBe('approved');
      expect(record?.pickup_from, task.id).not.toBeNull();
    }
  });
});
