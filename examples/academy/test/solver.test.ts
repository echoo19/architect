import { createChecker, createSandbox, createToolbox, openAgentFiles } from '@architect/engine';
import type { Checker, Sandbox } from '@architect/engine';
import { HarnessSchema } from '@architect/shared';
import type { CheckOutcome } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SKILLS } from '../src/tasks/build';
import { allAttempts } from './attempts';
import type { Attempt } from './attempts';
import { TODAY, job, orgOf } from './helpers';

/**
 * The reference solutions use only the agent's built-in tools, bound to the task's academy, so
 * their calls show what each task costs in turns and context. These tests replay every call
 * through the runner's own tools on that academy's files, compare the text the agent gets back,
 * and grade each end state and answer with the runner's checker. Until the engine binds tasks
 * to organizations itself, the test binds each task's data folder here.
 */

/** Model turns the agent gets: one tool call each, and one more for the reply with ANSWER. */
const MAX_STEPS = 16;
/** A third of Glimmer's 16k-token context, as for the other sample jobs. */
const MAX_CHARACTERS = 24_000;

const attempts = allAttempts();

describe('the reference solutions', () => {
  it(`fit every task in ${MAX_STEPS} turns, the answer included`, () => {
    expect(attempts).toHaveLength(300);
    for (const { task, tools } of attempts) {
      expect(tools.calls.length + 1, task.id).toBeLessThanOrEqual(MAX_STEPS);
    }
  });

  it(`read at most ${MAX_CHARACTERS.toLocaleString('en-US')} characters for any task`, () => {
    for (const { task, tools } of attempts) {
      expect(tools.characters, task.id).toBeLessThanOrEqual(MAX_CHARACTERS);
    }
  });

  it('pass every task with the checker in node', () => {
    for (const { task, tools, answer } of attempts) {
      if (task.expected.kind === 'facts') {
        for (const fact of task.expected.facts) {
          expect((answer as Record<string, unknown>)[fact.path], `${task.id} ${fact.path}`).toEqual(
            fact.value,
          );
        }
        continue;
      }
      const appended = {
        'assignments.csv': tools.appendedTo('assignments.csv'),
        'staff_notes.csv': tools.appendedTo('staff_notes.csv'),
      };
      expect(job.check(task, job.withAppended(task, appended, answer)), task.id).toMatchObject({
        pass: true,
      });
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
    meta: { format: 2, name: 'Tutor', version: 0, hash: '' },
    system: 'You are the Tutor, the academy tutor.',
    retrieval: {},
    decoding: {},
    guardrails: {},
  });

  /** Replays an attempt's calls on a scratch copy of its academy's files and grades what it left. */
  async function replay({ task, tools, answer }: Attempt) {
    const files = await openAgentFiles({
      dataDir: job.dataDir(orgOf(task)),
      files: job.job().data.files,
      mode: 'scratch',
    });
    const toolbox = createToolbox({ harness, files, sandbox, today: TODAY });
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

  it.each(SKILLS)(
    'get back exactly the text the model of the tools gives, and pass every %s task',
    async (skill) => {
      for (const attempt of attempts.filter((a) => a.task.type === skill)) {
        expect(await replay(attempt), attempt.task.id).toMatchObject({ pass: true });
      }
    },
    300_000,
  );
});
