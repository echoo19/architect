import { join } from 'node:path';
import { createChecker, createSandbox, createToolbox, openAgentFiles } from '@architect/engine';
import type { Checker, Sandbox } from '@architect/engine';
import { HarnessSchema } from '@architect/shared';
import type { CheckOutcome, JsonValue, Task } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderQuestion } from '../src/reference/orders';
import { answerOrder, solvePickup, solveReturn } from '../src/reference/solver';
import type { PickupRequest, ReturnRequest } from '../src/reference/solver';
import { AgentTools } from '../src/reference/tools';
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
 * task costs in turns and context. These tests replay every call through the runner's own tools
 * on this job's files and compare the text the agent gets back, grade each end state and answer
 * with the runner's checker, and check that every task fits in the agent's 16 turns.
 */

/** Model turns the agent gets: one tool call each, and one more for the reply with ANSWER. */
const MAX_STEPS = 16;
/** A third of Glimmer's 16k-token context, as for the first sample job. */
const MAX_CHARACTERS = 24_000;

interface Attempt {
  task: Task;
  tools: AgentTools;
  answer: JsonValue;
}

/** Every task solved once with a fresh set of tools, the way one agent attempt would. */
const attempts: Attempt[] = job.allTasks().map((task) => {
  const tools = new AgentTools(job.data());
  let answer: JsonValue;
  if (task.type === 'refund') {
    const request = task.meta?.request as unknown as ReturnRequest;
    const { decision, refund_cents, refund_to } = solveReturn(tools, request, BUSINESS_DATE).result;
    answer = { decision, refund_cents, refund_to };
  } else if (task.type === 'pickup') {
    const request = task.meta?.request as unknown as PickupRequest;
    const { carrier, pickup_date } = solvePickup(tools, request, BUSINESS_DATE).result;
    answer = { pickup_id: String(paramsOf(task).pickup_id), carrier, pickup_date };
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
      expect(tools.calls.length + 1, task.id).toBeLessThanOrEqual(MAX_STEPS);
    }
  });

  it(`read at most ${MAX_CHARACTERS.toLocaleString('en-US')} characters for any task`, () => {
    for (const { task, tools } of attempts) {
      expect(tools.characters, task.id).toBeLessThanOrEqual(MAX_CHARACTERS);
    }
  });
});

describe("the reference solutions through the runner's tools", () => {
  let sandbox: Sandbox;
  let checker: Checker;
  beforeAll(() => {
    sandbox = createSandbox();
    checker = createChecker({ job: job.job(), jobDir: job.dir, sandbox });
  });
  afterAll(() => sandbox.dispose());

  const harness = HarnessSchema.parse({
    meta: { format: 2, name: 'Returns desk', version: 0, hash: '' },
    system: 'You are the Returns desk agent.',
    retrieval: {},
    decoding: {},
    guardrails: {},
  });

  /** Replays an attempt's calls on a fresh scratch copy of the files and grades what it left. */
  async function replay({ task, tools, answer }: Attempt) {
    const files = await openAgentFiles({
      dataDir: join(job.dir, 'data'),
      files: job.job().data.files,
      mode: 'scratch',
    });
    const toolbox = createToolbox({ harness, files, sandbox, today: BUSINESS_DATE });
    for (const [index, call] of tools.calls.entries()) {
      const outcome = await toolbox.run({
        id: `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      });
      expect(outcome.content, `${task.id}, call ${index + 1} (${call.name})`).toBe(call.content);
    }
    const outcome: CheckOutcome = {
      finalText: `ANSWER: ${JSON.stringify(answer)}`,
      answer,
      toolCalls: tools.calls.map((call) => ({ name: call.name, arguments: call.arguments })),
      stopReason: 'answer',
    };
    return checker.check(task, outcome, files);
  }

  it('read long files in parts, numbered and noted the way the runner does', async () => {
    const tools = new AgentTools(job.data());
    // 200 short lines at a time, then lines long enough that 8,000 characters come first.
    tools.readAll('order_lines.csv');
    tools.readAll('orders.csv');
    expect(tools.calls[0]?.content).toMatch(
      /\n\[Lines 1-200 of 1038\. 838 more lines: read on with offset 201\.\]$/,
    );
    expect(tools.calls.find((call) => call.content.includes('ORD-10001,C-1107'))?.content).toMatch(
      /\n\[Lines 1-1\d\d of 596\. \d+ more lines: read on with offset 1\d\d\.\]$/,
    );
    const files = await openAgentFiles({
      dataDir: join(job.dir, 'data'),
      files: job.job().data.files,
      mode: 'scratch',
    });
    const toolbox = createToolbox({ harness, files, sandbox, today: BUSINESS_DATE });
    for (const [index, call] of tools.calls.entries()) {
      const outcome = await toolbox.run({
        id: `read_${index}`,
        name: 'read',
        arguments: call.arguments,
      });
      expect(outcome.content, `read ${index + 1}`).toBe(call.content);
    }
  });

  it.each(['refund', 'order', 'pickup'])(
    'get back exactly the text the model of the tools gives, and pass every %s task',
    async (type) => {
      for (const attempt of ofType(type)) {
        expect(await replay(attempt), attempt.task.id).toMatchObject({ pass: true });
      }
    },
    300_000,
  );
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
