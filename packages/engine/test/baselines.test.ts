import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LineageLog } from '../src/loop/lineage';
import { roundSeed } from '../src/loop/seeds';
import { hypothesis } from './fakes/adapters';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

beforeEach(async () => {
  world = await createWorld();
  engine = openEngine(world);
});

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

async function run(method: 'bare' | 'one_shot' | 'self_reflection') {
  const job = await engine.jobs.importFile(world.jobFile);
  const started = await engine.controller.start(job.id, method, 7);
  await engine.controller.idle();
  const record = engine.store.runs.get(started.id);
  if (!record) throw new Error('The run vanished.');
  expect(engine.errors).toEqual([]);
  return record;
}

describe('the bare baseline', () => {
  it('tests the blank harness with no mentor and no rounds', async () => {
    const { run: finished } = await run('bare');
    expect(finished).toMatchObject({
      status: 'finished',
      currentVersion: 1,
      devBaseline: { pass: 0, total: 9 },
    });
    expect(finished.stopReason).toBeUndefined();
    expect(engine.store.rounds.list(finished.id)).toEqual([]);
    expect(world.mentorsCreated).toBe(0);
    const report = engine.store.reports.get(finished.id, 'local');
    expect(report).toMatchObject({
      method: 'bare',
      mentor: { label: 'No mentor', model: '' },
      test: { score: { pass: 0, total: 6 } },
      topInterventions: [],
      overclaim: null,
      cost: { mentorUsd: 0, rounds: 0 },
    });
    expect(world.runtime.releases.map((session) => session.mentor)).toEqual([null]);
  });
});

describe('the one-shot baseline', () => {
  it('makes one mentor call without attempts, evaluates it on dev, and tests it', async () => {
    world.mentor.script = () =>
      hypothesis('Complete harness', 'fix:invoice\nfix:overdue', {
        predicted: { devDeltaMin: 4, devDeltaMax: 6, rationale: 'Two types covered.' },
        readyClaim: true,
      });
    const { run: finished } = await run('one_shot');

    expect(world.mentor.requests).toHaveLength(1);
    const [request] = world.mentor.requests;
    expect(request?.system).toContain('Write its whole harness in one go');
    const content = request?.messages[0]?.content ?? '';
    expect(content).toContain('[train] scheduling request number 2');
    expect(content).not.toContain('Trace:');
    expect(content).not.toContain('[dev]');
    expect(content).not.toContain('[test]');
    expect(world.runtime.attempts.filter((a) => a.taskId.startsWith('train-'))).toEqual([]);

    expect(finished).toMatchObject({
      status: 'finished',
      currentVersion: 2,
      devBaseline: { pass: 0, total: 9 },
      devCurrent: { pass: 6, total: 9 },
    });
    const [entry, ...rest] = await new LineageLog(
      engine.paths.lineageFile(finished.jobId, finished.id),
    ).read();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      round: 1,
      decision: 'kept',
      versionFrom: 1,
      versionTo: 2,
      measured: { delta: 6 },
    });
    expect(entry?.decisionReason).toContain('without a keep-or-revert check');
    expect(engine.store.reports.get(finished.id, 'local')).toMatchObject({
      method: 'one_shot',
      test: { score: { pass: 4, total: 6 } },
      cost: { rounds: 1 },
      overclaim: true,
    });
  });

  it('keeps the one-shot harness even when dev gets worse', async () => {
    world.runtime.passes = (task, harness) =>
      task.type === 'invoice'
        ? !harness.system.includes('strict')
        : harness.system.includes(`fix:${task.type}`);
    world.mentor.script = () => hypothesis('Strict harness', 'strict');
    const { run: finished } = await run('one_shot');
    expect(finished).toMatchObject({
      currentVersion: 2,
      devBaseline: { pass: 3, total: 9 },
      devCurrent: { pass: 0, total: 9 },
    });
  });
});

describe('the one-shot baseline, when its reply cannot be used', () => {
  it('gets the same single fix, with nothing about the student added', async () => {
    world.mentor.script = (_request, call) =>
      call === 1
        ? {
            ...hypothesis('Complete harness', ''),
            edits: [{ op: 'delete' as const, path: 'AGENTS.md', content: '' }],
          }
        : hypothesis('Complete harness', 'fix:invoice\nfix:overdue');
    const { run: finished } = await run('one_shot');

    expect(world.mentor.requests).toHaveLength(2);
    const [asked, fix] = world.mentor.requests;
    expect(fix?.messages.slice(0, -2)).toEqual(asked?.messages);
    expect(fix?.messages.at(-1)?.content).toContain('AGENTS.md: cannot be deleted.');
    expect(finished).toMatchObject({ currentVersion: 2, devCurrent: { pass: 6, total: 9 } });
    expect(engine.store.rounds.get(finished.id, 1)?.round).toMatchObject({
      decision: 'kept',
      draft: true,
    });
    expect(engine.store.graduates.forRun(finished.id)?.manifest.harness).toMatchObject({
      version: 2,
      round: 1,
      draft: true,
    });
  });
});

describe('the self-reflection baseline', () => {
  it('runs the architect loop with the student as its own author, at no mentor cost', async () => {
    world.studentReply = (_request, call) =>
      `My analysis:\n${JSON.stringify(
        [
          hypothesis('I forgot invoices', 'fix:invoice'),
          hypothesis('I forgot overdue too', 'fix:invoice\nfix:overdue'),
        ][call - 1],
      )}`;
    const record = await run('self_reflection');
    const { run: finished } = record;

    expect(world.mentorsCreated).toBe(0);
    expect(world.mentor.requests).toEqual([]);
    const author = world.students[0];
    expect(author?.chats).toHaveLength(2);
    expect(author?.chats.map((chat) => chat.seed)).toEqual([
      roundSeed(record.seeds.mentor, 1),
      roundSeed(record.seeds.mentor, 2),
    ]);
    expect(author?.chats[0]?.messages[0]?.content).toContain('Propose exactly one hypothesis');

    expect(finished).toMatchObject({ status: 'finished', stopReason: 'rounds', currentVersion: 3 });
    expect(engine.store.lineage.list(finished.id).map((row) => row.decision)).toEqual([
      'kept',
      'kept',
    ]);
    expect(engine.store.reports.get(finished.id, 'local')).toMatchObject({
      method: 'self_reflection',
      mentor: { label: 'Glimmer (self-reflection)', model: 'glimmer:test' },
      cost: { mentorUsd: 0, mentorInputTokens: 600, mentorOutputTokens: 160, rounds: 2 },
      test: { score: { pass: 4, total: 6 } },
    });
    expect(world.runtime.releases.map((session) => session.mentor)).toEqual([null]);
  });

  it('ends the round without a change when the student’s reply is not a hypothesis', async () => {
    world.studentReply = () => 'I am not sure what went wrong.';
    const { run: finished } = await run('self_reflection');
    const rounds = engine.store.rounds.list(finished.id);
    expect(rounds.map(({ round }) => round.status)).toEqual(['failed', 'failed']);
    expect(rounds[0]?.round.error).toBe('The reply contained no JSON object.');
    expect(finished).toMatchObject({ status: 'finished', currentVersion: 1 });
  });
});
