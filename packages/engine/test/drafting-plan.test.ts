import type { JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { pickExamples, requestText } from '../src/drafting/plan';

/** A task of one type whose answer is the given value, asked about its own customer. */
function listTask(index: number, answer: JsonValue, family = `f-${index}`): Task {
  return {
    id: `t-${String(index).padStart(3, '0')}`,
    type: 'open',
    family,
    prompt: `Which tickets of C-${index} are open?\nEnd with: ANSWER: [...]`,
    expected: { kind: 'answer', value: answer, compare: { mode: 'set' } },
    meta: { request: `Which tickets of C-${index} are open?` },
  };
}

function totalTask(index: number, total: number): Task {
  return {
    id: `t-${String(index).padStart(3, '0')}`,
    type: 'totals',
    family: `g-${index}`,
    prompt: `What did group ${index} spend?\nEnd with: ANSWER: {"total": <number>}`,
    expected: { kind: 'answer', value: { total }, compare: { mode: 'number', tolerance: 0.005 } },
    meta: { request: `What did group ${index} spend?` },
  };
}

const tickets = (count: number): string[] => Array.from({ length: count }, (_, i) => `T-${i + 1}`);

describe('choosing the examples that show a type', () => {
  it('shows an empty answer, a short one and a long one rather than the first three', () => {
    // The first tasks are all alike; the variety is further down.
    const tasks = [
      listTask(1, tickets(1)),
      listTask(2, tickets(1)),
      listTask(3, tickets(1)),
      listTask(4, tickets(2)),
      listTask(5, tickets(3)),
      listTask(6, tickets(5)),
      listTask(7, tickets(9)),
      listTask(8, []),
    ];
    const picked = pickExamples(tasks);
    expect(picked).toHaveLength(3);
    const sizes = picked.map((task) =>
      task.expected.kind === 'answer' ? (task.expected.value as unknown[]).length : -1,
    );
    expect(sizes[0]).toBe(0);
    expect(new Set(sizes).size).toBe(3);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(5);
    expect(picked.map((task) => task.id)).not.toEqual(['t-001', 't-002', 't-003']);
  });

  it('spreads numbers along their range and never gives two examples the same answer size', () => {
    const tasks = [10, 12, 12, 15, 40, 41, 90, 250, 900, 3_000].map((total, i) =>
      totalTask(i + 1, total),
    );
    const totals = pickExamples(tasks).map((task) =>
      task.expected.kind === 'answer' ? (task.expected.value as { total: number }).total : -1,
    );
    expect(totals).toHaveLength(3);
    expect(totals[0]).toBeLessThan(totals[1] ?? 0);
    expect(totals[1]).toBeLessThan(totals[2] ?? 0);
    // Neither the smallest nor the largest, which are the odd cases of the type.
    expect(totals).not.toContain(10);
    expect(totals).not.toContain(3_000);
  });

  it('never shows one request twice, nor more examples than there are different requests', () => {
    const tasks = [listTask(1, []), { ...listTask(1, []), id: 'again', family: 'other' }];
    const picked = pickExamples(tasks);
    expect(picked.map((task) => task.id)).toEqual(['t-001']);
    expect(new Set(pickExamples([...tasks, listTask(2, ['T-1'])]).map(requestText)).size).toBe(2);
  });

  it('keeps to the order it is given among tasks that are alike, and avoids showing a family twice', () => {
    const tasks = [
      listTask(1, ['A', 'B'], 'same'),
      listTask(2, ['C', 'D'], 'same'),
      listTask(3, ['E', 'F'], 'other'),
      listTask(4, tickets(6), 'third'),
    ];
    const picked = pickExamples(tasks, 2);
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((task) => task.family)).size).toBe(2);
    // Same answer size: the first in the order given wins, which is a practice task over a
    // starting one when the caller lists them that way.
    expect(pickExamples([listTask(1, ['A', 'B']), listTask(2, ['C', 'D'])], 1)[0]?.id).toBe(
      't-001',
    );
  });

  it('fills up with other sizes when there are fewer than it wants of one kind', () => {
    const tasks = [listTask(1, ['A']), listTask(2, ['B']), listTask(3, ['C']), listTask(4, [])];
    const picked = pickExamples(tasks);
    expect(picked.map((task) => task.id).sort()).toEqual(['t-001', 't-002', 't-004']);
  });
});
