import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChecker, createSandbox, openTableStore } from '@architect/engine';
import type { Checker, Sandbox } from '@architect/engine';
import type { CheckOutcome, JsonValue, Task } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import {
  expectedOrderAnswer,
  expectedPickupRow,
  expectedReturnAnswer,
  expectedReturnRow,
  job,
} from './helpers';

/**
 * The checker module run the way the runner runs it: in QuickJS inside the sandbox's child
 * process, on the table store's end state, through the engine's own checker.
 */

let dir: string;
let sandbox: Sandbox;
let checker: Checker;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gear-returns-job-'));
  cpSync(job.dir, dir, { recursive: true });
  sandbox = createSandbox();
  checker = createChecker({ job: job.job(), jobDir: dir, sandbox });
});

afterAll(async () => {
  await sandbox.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const outcome = (answer: JsonValue | null): CheckOutcome => ({
  finalText: answer === null ? 'Done.' : `ANSWER: ${JSON.stringify(answer)}`,
  answer,
  toolCalls: [],
  stopReason: 'answer',
});

async function check(
  task: Task,
  append: { file: string; row: CsvRow } | null,
  answer: JsonValue | null,
) {
  const store = await openTableStore({
    dataDir: join(dir, 'data'),
    files: job.job().data.files,
    mode: 'scratch',
  });
  if (append) store.append(append.file, [append.row]);
  return checker.check(task, outcome(answer), store);
}

const firstOf = (type: string, count: number) => job.tasksOfType(type).slice(0, count);

describe('the checker in the sandbox', () => {
  it('passes the ground truth of refund, pickup and order tasks', async () => {
    for (const task of firstOf('refund', 4)) {
      const row = expectedReturnRow(task);
      const result = await check(task, { file: 'returns.csv', row }, expectedReturnAnswer(task));
      expect(result, task.id).toMatchObject({ pass: true });
    }
    for (const task of firstOf('pickup', 4)) {
      const result = await check(task, { file: 'pickups.csv', row: expectedPickupRow(task) }, null);
      expect(result, task.id).toMatchObject({ pass: true });
    }
    for (const task of firstOf('order', 4)) {
      expect(await check(task, null, expectedOrderAnswer(task)), task.id).toMatchObject({
        pass: true,
      });
    }
  });

  it('fails a wrong refund, a wrong pickup date and a wrong answer with the same reasons', async () => {
    const refund = firstOf('refund', 1)[0] as Task;
    const row = { ...expectedReturnRow(refund), item_cents: '1' };
    const local = job.check(
      refund,
      job.withAppended('returns.csv', [row], expectedReturnAnswer(refund)),
    );
    const inSandbox = await check(
      refund,
      { file: 'returns.csv', row },
      expectedReturnAnswer(refund),
    );
    expect(inSandbox).toMatchObject({ pass: false, reason: local.reason });

    const pickup = firstOf('pickup', 1)[0] as Task;
    const late = { ...expectedPickupRow(pickup), pickup_date: '2026-11-26' };
    const pickupResult = await check(pickup, { file: 'pickups.csv', row: late }, null);
    expect(pickupResult).toMatchObject({
      pass: false,
      reason: job.check(pickup, job.withAppended('pickups.csv', [late])).reason,
    });

    const order = firstOf('order', 1)[0] as Task;
    const answer = { ...expectedOrderAnswer(order), spent_cents: 1 };
    expect(await check(order, null, answer)).toMatchObject({
      pass: false,
      reason: job.check(order, job.contextWith({}, answer)).reason,
    });
  });
});
