import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TaskSchema,
  type CheckOutcome,
  type ExpectedSchema,
  type JsonValue,
  type Task,
} from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CheckerError, createChecker, type Checker } from '../src/checker/checker';
import { openTableStore, type TableStore } from '../src/data/table-store';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { makeJob, makeJobDir, SAMPLE_FILES, type TempJob } from './support/fixtures';

const task = (expected: z.input<typeof ExpectedSchema>, id = 't1'): Task =>
  TaskSchema.parse({
    id,
    type: 'overdue',
    family: id,
    prompt: 'Which invoices are overdue?',
    expected,
  });

const outcome = (fields: Partial<CheckOutcome> = {}): CheckOutcome => ({
  finalText: '',
  answer: null,
  toolCalls: [],
  stopReason: 'answer',
  ...fields,
});
const answered = (answer: JsonValue): CheckOutcome =>
  outcome({ answer, finalText: `ANSWER: ${JSON.stringify(answer)}` });

const CHECKER_SOURCE = `
var validators = {
  invoice_created: function (params, ctx) {
    var before = ctx.readOriginalTable('invoices.csv');
    var added = ctx.readTable('invoices.csv').filter(function (row) {
      return !before.some(function (old) { return old.invoice_id === row.invoice_id; });
    });
    if (added.length !== 1) {
      return { pass: false, reason: 'Expected one new invoice, but found ' + added.length + '.' };
    }
    if (added[0].total_cents !== String(params.total_cents)) {
      return { pass: false, reason: 'Expected total_cents ' + params.total_cents + ', but it is ' + added[0].total_cents + '.' };
    }
    return { pass: true, reason: 'The invoice is right.', details: { invoice_id: added[0].invoice_id, answer: ctx.answer, calls: ctx.toolCalls.length } };
  },
  wrong_shape: function () { return { pass: 'yes' }; },
  throws: function (params, ctx) { return ctx.readTable('invoices.csv')[99].total_cents; },
  uses_clock: function () { return { pass: Date.now() > 0, reason: 'It read the clock.' }; }
};
`;

let job: TempJob;
let sandbox: Sandbox;
let builtin: Checker;

beforeAll(() => {
  job = makeJobDir();
  writeFileSync(join(job.dir, 'checker.js'), CHECKER_SOURCE);
  sandbox = createSandbox();
  builtin = createChecker({ job: makeJob(), jobDir: job.dir, sandbox });
});
afterAll(async () => {
  await sandbox.dispose();
  job.remove();
});

async function scratch(): Promise<TableStore> {
  return openTableStore({ dataDir: job.dataDir, files: SAMPLE_FILES, mode: 'scratch' });
}

async function check(expected: z.input<typeof ExpectedSchema>, attempt: CheckOutcome) {
  return builtin.check(task(expected), attempt, await scratch());
}

describe('answer checks', () => {
  it('normalizes text, numbers and key order', async () => {
    const expected = { customer: 'Ada Park', overdue_cents: 1500, invoices: ['INV-1', 'INV-3'] };
    const result = await check(
      { kind: 'answer', value: expected },
      answered({
        invoices: [' inv-1', 'INV-3 '],
        overdue_cents: '1500',
        customer: '  ada   PARK ',
      }),
    );
    expect(result).toEqual({ pass: true, reason: 'The answer matches the expected value.' });
  });

  it.each([
    [
      { customers: [{ id: 'C-1', overdue_cents: 1500 }] },
      { customers: [{ id: 'C-1', overdue_cents: 1200 }] },
      'Expected customers[0].overdue_cents to be 1500, but it is 1200.',
    ],
    [
      { customer_id: 'C-12', cents: 5 },
      { cents: 5 },
      'The answer has no customer_id; expected "C-12".',
    ],
    [{ cents: 5 }, { cents: 5, total: 7 }, 'The answer has an unexpected key total.'],
    [['INV-1', 'INV-2'], ['INV-1'], 'Expected the answer to have 2 items, but it has 1.'],
    [
      ['INV-1', 'INV-2'],
      ['INV-2', 'INV-1'],
      'Expected the answer[0] to be "INV-1", but it is "INV-2".',
    ],
    [{ cents: 5 }, [5], 'Expected the answer to be an object, but it is [5].'],
    [42, 'forty-two', 'Expected the answer to be 42, but it is "forty-two".'],
    [true, 'true', 'Expected the answer to be true, but it is "true".'],
  ])('names the first difference in exact mode (%#)', async (expected, actual, reason) => {
    expect(await check({ kind: 'answer', value: expected }, answered(actual))).toEqual({
      pass: false,
      reason,
    });
  });

  it('compares lists as sets in set mode', async () => {
    const expected = {
      kind: 'answer' as const,
      value: ['INV-1', 'INV-2'],
      compare: { mode: 'set' as const },
    };
    expect((await check(expected, answered(['inv-2', 'INV-1', 'INV-1']))).pass).toBe(true);
    expect(await check(expected, answered(['INV-2']))).toEqual({
      pass: false,
      reason: 'Expected the answer to include "INV-1", but it does not.',
    });
    expect(await check(expected, answered(['INV-1', 'INV-2', 'INV-9']))).toEqual({
      pass: false,
      reason: 'The answer includes "INV-9", which was not expected.',
    });
  });

  it('compares numbers within the tolerance in number mode', async () => {
    const expected = {
      kind: 'answer' as const,
      value: 100,
      compare: { mode: 'number' as const, tolerance: 0.5 },
    };
    expect((await check(expected, answered('100.4'))).pass).toBe(true);
    expect(await check(expected, answered(101))).toEqual({
      pass: false,
      reason: 'Expected the answer to be 100 (within 0.5), but it is 101.',
    });
  });

  it('compares only the listed keys, with set keys as sets', async () => {
    const expected = {
      kind: 'answer' as const,
      value: { customer_id: 'C-1', invoices: ['INV-1', 'INV-3'], note: 'ignored' },
      compare: { mode: 'exact' as const, keys: ['customer_id', 'invoices'], setKeys: ['invoices'] },
    };
    expect(
      (
        await check(
          expected,
          answered({ invoices: ['INV-3', 'INV-1'], customer_id: 'c-1', extra: 1 }),
        )
      ).pass,
    ).toBe(true);
    expect(await check(expected, answered({ customer_id: 'C-1', invoices: ['INV-3'] }))).toEqual({
      pass: false,
      reason: 'Expected invoices to include "INV-1", but it does not.',
    });
    await expect(
      check({ ...expected, compare: { mode: 'exact', keys: ['missing'] } }, answered({})),
    ).rejects.toThrow(CheckerError);
  });

  it('fails a missing or invalid ANSWER line with the reason', async () => {
    const expected = { kind: 'answer' as const, value: 1 };
    expect(
      await check(expected, outcome({ answerError: 'The reply has no ANSWER line.' })),
    ).toEqual({
      pass: false,
      reason: 'The reply has no ANSWER line.',
    });
    expect(
      await check(
        expected,
        outcome({ answerError: 'The reply has no ANSWER line.', stopReason: 'max_steps' }),
      ),
    ).toEqual({ pass: false, reason: 'The agent ran out of steps before giving an ANSWER line.' });
  });

  it('fails attempts that were refused, aborted or ended in an error, whatever they answered', async () => {
    const expected = { kind: 'answer' as const, value: 1 };
    expect((await check(expected, outcome({ answer: 1, stopReason: 'refused' }))).reason).toBe(
      'The agent refused the request instead of doing it.',
    );
    expect((await check(expected, outcome({ answer: 1, stopReason: 'aborted' }))).reason).toBe(
      'The attempt was stopped before it finished.',
    );
    expect((await check(expected, outcome({ answer: 1, stopReason: 'error' }))).reason).toBe(
      'The attempt ended with an error before the agent finished.',
    );
  });
});

describe('fact checks', () => {
  const facts = {
    kind: 'facts' as const,
    facts: [
      { path: 'customer.name', value: 'Ada Park' },
      { path: 'invoices.1.cents', value: 990 },
      { path: 'invoices[0].id', value: 'INV-1' },
    ],
  };

  it('passes when every path holds its value', async () => {
    const answer: JsonValue = {
      customer: { name: 'ada park', city: 'Ferncliff' },
      invoices: [{ id: 'INV-1' }, { id: 'INV-3', cents: '990' }],
    };
    expect(await check(facts, answered(answer))).toEqual({
      pass: true,
      reason: 'All 3 facts hold.',
    });
  });

  it('names the first fact that does not hold', async () => {
    expect(
      await check(
        facts,
        answered({ customer: { name: 'Ada Park' }, invoices: [{ id: 'INV-1' }, { cents: 900 }] }),
      ),
    ).toEqual({
      pass: false,
      reason: 'Expected invoices[1].cents to be 990, but it is 900.',
    });
    expect(await check(facts, answered({ invoices: [] }))).toEqual({
      pass: false,
      reason: 'The answer has no customer.name; expected "Ada Park".',
    });
  });
});

describe('end-state checks', () => {
  const moduleJob = makeJob({ checker: { kind: 'module', path: 'checker.js' } });
  const endState = (validator: string, params: Record<string, JsonValue> = {}) =>
    task({ kind: 'end_state', validator, params });
  const appended = async (row: Record<string, string>) => {
    const store = await scratch();
    store.append('invoices.csv', [row]);
    return store;
  };
  let checker: Checker;
  beforeAll(() => {
    checker = createChecker({ job: moduleJob, jobDir: job.dir, sandbox });
  });

  it('runs the job checker module on the end state and the original data', async () => {
    const store = await appended({ invoice_id: 'INV-4', total_cents: '2500' });
    const attempt = outcome({
      answer: { invoice_id: 'INV-4' },
      toolCalls: [{ name: 'append_rows', arguments: { file: 'invoices.csv' } }],
    });
    expect(
      await checker.check(endState('invoice_created', { total_cents: 2500 }), attempt, store),
    ).toEqual({
      pass: true,
      reason: 'The invoice is right.',
      details: { invoice_id: 'INV-4', answer: { invoice_id: 'INV-4' }, calls: 1 },
    });
    const wrong = await appended({ invoice_id: 'INV-4', total_cents: '2400' });
    expect(
      await checker.check(endState('invoice_created', { total_cents: 2500 }), outcome(), wrong),
    ).toEqual({
      pass: false,
      reason: 'Expected total_cents 2500, but it is 2400.',
    });
    expect(
      (
        await checker.check(
          endState('invoice_created', { total_cents: 2500 }),
          outcome(),
          await scratch(),
        )
      ).reason,
    ).toBe('Expected one new invoice, but found 0.');
  });

  it('gives the same result for the same inputs, every time', async () => {
    const store = await appended({ invoice_id: 'INV-4', total_cents: '2400' });
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        checker.check(endState('invoice_created', { total_cents: 2500 }), outcome(), store),
      ),
    );
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
  });

  it('fails attempts when the validator throws, including on any use of the clock', async () => {
    const store = await scratch();
    expect((await checker.check(endState('throws'), outcome(), store)).reason).toMatch(
      /^The validator throws failed on this end state: TypeError: .*\(checker\.js:\d+/,
    );
    expect((await checker.check(endState('uses_clock'), outcome(), store)).reason).toMatch(
      /no clock/,
    );
  });

  it('raises CheckerError when the module or a validator is broken', async () => {
    const store = await scratch();
    await expect(checker.check(endState('wrong_shape'), outcome(), store)).rejects.toThrow(
      'The validator wrong_shape returned {"pass":"yes"} instead of { pass, reason }.',
    );
    await expect(checker.check(endState('missing'), outcome(), store)).rejects.toThrow(
      'The checker module could not run the validator missing: The checker module has no validator named "missing".',
    );
    await expect(builtin.check(endState('invoice_created'), outcome(), store)).rejects.toThrow(
      'A task is checked by end state, but the job has no checker module.',
    );
    const outside = createChecker({
      job: makeJob({ checker: { kind: 'module', path: '../checker.js' } }),
      jobDir: job.dir,
      sandbox,
    });
    await expect(outside.check(endState('invoice_created'), outcome(), store)).rejects.toThrow(
      'The checker module ../checker.js must be inside the job folder.',
    );
  });

  it('reads the checker module once', async () => {
    const copy = makeJobDir();
    writeFileSync(join(copy.dir, 'checker.js'), CHECKER_SOURCE);
    const once = createChecker({ job: moduleJob, jobDir: copy.dir, sandbox });
    const store = await openTableStore({
      dataDir: copy.dataDir,
      files: SAMPLE_FILES,
      mode: 'scratch',
    });
    const first = await once.check(
      endState('invoice_created', { total_cents: 1 }),
      outcome(),
      store,
    );
    rmSync(join(copy.dir, 'checker.js'));
    expect(
      await once.check(endState('invoice_created', { total_cents: 1 }), outcome(), store),
    ).toEqual(first);
    copy.remove();
  });
});
