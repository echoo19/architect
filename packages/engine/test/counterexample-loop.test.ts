import type { Job } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { FoundCounterexample } from '../src/counterexamples/find';
import { hypothesis } from './fakes/adapters';
import { defaultJob } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

const HASH = 'a'.repeat(64);

/** A lookup that threw on train-invoice-1, cut down to the two rows it still throws on. */
function lookupCrash(attemptId: string): FoundCounterexample {
  return {
    taskId: 'train-invoice-1',
    attemptId,
    callId: 'c1',
    helper: { name: 'job_lookup', codeHash: HASH },
    arguments: { job_id: 'J-1', section: 'Labor' },
    predicate: { kind: 'threw', message: 'job line not found' },
    tables: {
      'jobs.csv': {
        columns: ['job_id', 'section', 'minutes'],
        rows: [
          { job_id: 'J-1', section: 'Full', minutes: '90' },
          { job_id: 'J-1', section: 'Full', minutes: '30' },
        ],
      },
    },
    texts: {},
    size: { originalRows: 1990, reducedRows: 2, originalColumns: 40, reducedColumns: 3 },
    minimality: '1-minimal',
    steps: 12,
    hashes: { original: HASH, reduced: 'b'.repeat(64) },
  };
}

const SPEC = JSON.stringify({
  name: 'job_lookup',
  description: 'Finds a job line.',
  parameters: { type: 'object', properties: {} },
});

/** A change to the lookup helper; code that says "still broken" fails every case of the fake suite. */
const helperChange = (title: string, code: string) => ({
  ...hypothesis(title, 'Service desk.\nfix:invoice'),
  edits: [
    { op: 'write' as const, path: 'AGENTS.md', content: 'Service desk.\nfix:invoice' },
    { op: 'write' as const, path: 'tools/job_lookup.json', content: SPEC },
    { op: 'write' as const, path: 'tools/job_lookup.js', content: code },
  ],
});

async function setUp(maxRounds: number): Promise<Job> {
  world = await createWorld({ job: { budget: { ...defaultJob().budget, maxRounds } } });
  engine = openEngine(world);
  return engine.jobs.importFile(world.jobFile);
}

describe('counterexample-guided repair', () => {
  it('shows the mentor the reduced case, refuses a repair that fails it, and keeps one that passes', async () => {
    const job = await setUp(2);
    let rounds = 0;
    world.runtime.counterexamples = (search) => {
      rounds += 1;
      const failed = search.attempts.find((attempt) => attempt.task.id === 'train-invoice-1');
      return rounds === 1 && failed ? [lookupCrash(failed.attemptId)] : [];
    };
    world.mentor.script = (_request, call) =>
      [
        helperChange('Join on the job id', 'function run() { /* still broken */ return 1; }'),
        helperChange('Join on the job id', 'function run() { return 1; }'),
        helperChange('Break the lookup again', 'function run() { /* still broken */ return 2; }'),
        helperChange('Break the lookup again', 'function run() { /* still broken */ return 3; }'),
      ][call - 1];
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    // The mentor's first request holds the reduced case, not the attempt's whole tables.
    const first = world.mentor.requests[0]?.messages.map((message) => message.content).join('\n');
    expect(first).toContain('# Counterexamples');
    expect(first).toContain('job_lookup stops with the error "job line not found"');
    expect(first).toContain('1990 rows reduced to 2');
    expect(world.runtime.searches[0]).toContain('train-invoice-1');

    const [cx] = engine.store.counterexamples.list({ jobId: job.id });
    if (!cx) throw new Error('No counterexample was stored.');
    expect(cx).toMatchObject({ runId: run.id, round: 1, helper: { name: 'job_lookup' } });

    // The first try fails the reduced and the original case and goes back with the reason; the
    // fix passes both and is measured on dev as usual.
    expect(world.runtime.suites.slice(0, 2)).toEqual([
      { tool: 'job_lookup', cases: [`${cx.id}:reduced`, `${cx.id}:original`] },
      { tool: 'job_lookup', cases: [`${cx.id}:reduced`, `${cx.id}:original`] },
    ]);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(
      'tools/job_lookup.js fails 2 of the 2 cases of its counterexamples. Still fails.',
    );
    expect(engine.store.rounds.get(run.id, 1)).toMatchObject({
      rejected: false,
      reply: { fix: 1 },
      round: { decision: 'kept' },
    });
    expect(cx.repair).toMatchObject({ round: 1, passed: true });

    // Round 2 breaks the helper again: the counterexample is now a regression test, run on its
    // reduced case alone, and the change never reaches dev.
    expect(world.runtime.suites.slice(2)).toEqual([
      { tool: 'job_lookup', cases: [`${cx.id}:reduced`] },
      { tool: 'job_lookup', cases: [`${cx.id}:reduced`] },
    ]);
    expect(engine.store.rounds.get(run.id, 2)).toMatchObject({ rejected: true });
    expect(engine.store.counterexamples.get(cx.id)?.repair).toMatchObject({
      round: 1,
      passed: true,
    });
  });

  it('runs no search and no suite for a comparison arm', async () => {
    const job = await setUp(1);
    world.runtime.counterexamples = (search) => [lookupCrash(search.attempts[0]?.attemptId ?? '')];
    world.mentor.script = () => helperChange('Join on the job id', 'function run() { return 1; }');
    await engine.controller.start(job.id, 'self_reflection', 7);
    await engine.controller.idle();
    expect(world.runtime.searches).toEqual([]);
    expect(world.runtime.suites).toEqual([]);
    expect(engine.store.counterexamples.list({ jobId: job.id })).toEqual([]);
  });
});
