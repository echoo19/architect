import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTableStore } from '@architect/engine';
import type { TableStore } from '@architect/engine';
import type { JsonValue, Task, WhereClause } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderQuestion } from '../src/reference/orders';
import { answerOrder, solvePickup, solveReturn } from '../src/reference/solver';
import type { PickupRequest, ReturnRequest } from '../src/reference/solver';
import { DeskTools } from '../src/reference/tools';
import type { Condition } from '../src/reference/tools';
import {
  BUSINESS_DATE,
  expectedOrderAnswer,
  expectedPickupRow,
  expectedReturnRow,
  job,
  paramsOf,
} from './helpers';
import { orderAnswerFromCsv, pickupFromCsv, decideFromCsv } from './oracles';
import type { OrderQuestionFacts } from './oracles';

/**
 * The reference solutions use only the agent's built-in tools, so their calls show what each
 * task costs in turns and context. These tests check those tools behave like the runner's on this
 * job's files, that the solutions reach every expected answer, and that every task fits in the
 * agent's 16 turns.
 */

/** Model turns the agent gets: one tool call each, and one more for the reply with ANSWER. */
const MAX_STEPS = 16;
/** A third of Glimmer's 16k-token context, as for the first sample job. */
const MAX_CHARACTERS = 24_000;

let dataDir: string;
let store: TableStore;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'gear-returns-data-'));
  // The runner loads the job's data files from its own folder; a copy keeps the job untouched.
  cpSync(join(job.dir, 'data'), dataDir, { recursive: true });
  store = await openTableStore({ dataDir, files: job.job().data.files, mode: 'scratch' });
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the reference tools against the runner's", () => {
  it("read every table cell for cell the way the runner's CSV parser does", () => {
    for (const [name, table] of job.data().tables) {
      const runner = store.read(name, { limit: 200 });
      expect([...runner.columns], name).toEqual([...table.columns]);
      const all: unknown[] = [];
      for (let offset = 0; offset < runner.total; offset += 200) {
        all.push(...store.read(name, { limit: 200, offset }).rows);
      }
      expect(all, name).toEqual(table.rows);
    }
  });

  it('filter rows the same way, for every operator and the values that are written another way', () => {
    const product = job
      .table('products.csv')
      .find((row) => row.sku !== row.sku?.trim().toUpperCase());
    const customer = job
      .table('customers.csv')
      .find((row) => row.email !== row.email?.trim().toLowerCase());
    const reads: { file: string; where: WhereClause[] }[] = [
      { file: 'orders.csv', where: [{ column: 'order_date', op: '>=', value: '2026-10-01' }] },
      { file: 'orders.csv', where: [{ column: 'order_date', op: '<', value: 'May' }] },
      { file: 'orders.csv', where: [{ column: 'shipped_on', op: '=', value: null }] },
      { file: 'orders.csv', where: [{ column: 'shipping', op: '>', value: 5 }] },
      { file: 'orders.csv', where: [{ column: 'payment', op: '!=', value: 'card' }] },
      { file: 'order_lines.csv', where: [{ column: 'unit_price', op: '<=', value: '29.95' }] },
      { file: 'order_lines.csv', where: [{ column: 'qty', op: 'in', value: [2, '3'] }] },
      {
        file: 'products.csv',
        where: [{ column: 'sku', op: '=', value: product?.sku?.trim().toUpperCase() ?? '' }],
      },
      {
        file: 'products.csv',
        where: [{ column: 'sku', op: 'contains', value: product?.sku?.trim() ?? '' }],
      },
      {
        file: 'customers.csv',
        where: [
          { column: 'email', op: 'contains', value: customer?.email?.trim().toLowerCase() ?? '' },
        ],
      },
      {
        file: 'customers.csv',
        where: [{ column: 'email', op: '=', value: customer?.email?.trim().toLowerCase() ?? '' }],
      },
      { file: 'pickups.csv', where: [{ column: 'pickup_date', op: 'contains', value: '/' }] },
    ];
    for (const read of reads) {
      const runner = store.read(read.file, { where: read.where, limit: 200 });
      const tools = new DeskTools(job.data());
      const ours = tools.readTable({
        file: read.file,
        where: read.where.map((clause) => ({ ...clause }) as Condition),
        limit: 200,
      });
      expect(ours.total, JSON.stringify(read)).toBe(runner.total);
      expect(ours.rows, JSON.stringify(read)).toEqual(runner.rows.slice(0, ours.rows.length));
    }
  });

  it('miss a SKU or an email written another way when matched exactly, and find it with contains', () => {
    const tools = new DeskTools(job.data());
    const odd = job.table('products.csv').find((row) => row.sku !== row.sku?.trim().toUpperCase());
    const sku = String(odd?.sku).trim().toUpperCase();
    expect(
      tools.readTable({ file: 'products.csv', where: [{ column: 'sku', op: '=', value: sku }] })
        .total,
    ).toBe(0);
    expect(
      tools.readTable({
        file: 'products.csv',
        where: [{ column: 'sku', op: 'contains', value: sku }],
      }).total,
    ).toBe(1);
  });
});

interface Attempt {
  task: Task;
  tools: DeskTools;
  answer: JsonValue;
}

/** Every task solved once with a fresh set of tools, the way one agent attempt would. */
const attempts: Attempt[] = job.allTasks().map((task) => {
  const tools = new DeskTools(job.data());
  let answer: JsonValue = null;
  if (task.type === 'refund') {
    solveReturn(tools, task.meta?.request as unknown as ReturnRequest, BUSINESS_DATE);
  } else if (task.type === 'pickup') {
    solvePickup(tools, task.meta?.request as unknown as PickupRequest, BUSINESS_DATE);
  } else {
    answer = answerOrder(tools, task.meta?.question as unknown as OrderQuestion).result;
  }
  return { task, tools, answer };
});
const ofType = (type: string) => attempts.filter((a) => a.task.type === type);

describe('the reference solutions', () => {
  it('record the ground-truth return for every refund task', () => {
    for (const { task, tools } of ofType('refund')) {
      expect(tools.appendedTo('returns.csv'), task.id).toEqual([expectedReturnRow(task)]);
    }
  });

  it('book the ground-truth pickup for every pickup task', () => {
    for (const { task, tools } of ofType('pickup')) {
      expect(tools.appendedTo('pickups.csv'), task.id).toEqual([expectedPickupRow(task)]);
    }
  });

  it('give the ground-truth answer to every order question', () => {
    for (const { task, answer } of ofType('order')) {
      expect(answer, task.id).toEqual(expectedOrderAnswer(task));
    }
  });

  it(`fit every task in ${MAX_STEPS} turns, the answer included`, () => {
    expect(attempts).toHaveLength(180);
    for (const { task, tools } of attempts) {
      expect(tools.calls + 1, task.id).toBeLessThanOrEqual(MAX_STEPS);
    }
  });

  it(`read at most ${MAX_CHARACTERS.toLocaleString('en-US')} characters for any task`, () => {
    for (const { task, tools } of attempts) {
      expect(tools.characters, task.id).toBeLessThanOrEqual(MAX_CHARACTERS);
    }
  });
});

describe('a second implementation of the policy', () => {
  it('agrees with every refund task', () => {
    const before = job.table('returns.csv');
    for (const task of job.tasksOfType('refund')) {
      const request = task.meta?.request as unknown as ReturnRequest;
      const params = paramsOf(task);
      expect(
        decideFromCsv(
          job,
          { ...request, condition: request.condition as string },
          BUSINESS_DATE,
          before,
        ),
        task.id,
      ).toEqual({
        decision: params.decision,
        item_cents: params.item_cents,
        restocking_fee_cents: params.restocking_fee_cents,
        return_shipping_cents: params.return_shipping_cents,
        shipping_refund_cents: params.shipping_refund_cents,
        refund_cents: params.refund_cents,
        refund_to: params.refund_to,
      });
    }
  });

  it('agrees with every pickup task', () => {
    for (const task of job.tasksOfType('pickup')) {
      const { return_id, booked_at } = task.meta?.request as unknown as PickupRequest;
      const params = paramsOf(task);
      expect(pickupFromCsv(job, return_id, booked_at), task.id).toEqual({
        carrier: params.carrier,
        pickup_date: params.pickup_date,
      });
    }
  });

  it('agrees with every order question', () => {
    for (const task of job.tasksOfType('order')) {
      const question = task.meta?.question as unknown as OrderQuestionFacts;
      expect(orderAnswerFromCsv(job, question), task.id).toEqual(expectedOrderAnswer(task));
    }
  });
});
