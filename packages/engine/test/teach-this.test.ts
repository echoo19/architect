import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { currentDigest } from '@architect/harness';
import type { Correction, CorrectionRequest, WorkspaceMessage } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyedLock } from '../src/graduates/library';
import { improvementsOf } from '../src/improve/improvement';
import { NO_LOCKED_TEST } from '../src/loop/retest';
import { LESSONS_HEADING, TeachThis } from '../src/improve/teach-this';
import { hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { task } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
const engines: Engine[] = [];

function open(): Engine {
  const engine = openEngine(world);
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  world.cleanup();
});

const teachThis = (engine: Engine) =>
  new TeachThis({
    store: engine.store,
    paths: engine.paths,
    jobs: engine.jobs,
    deps: world.deps,
    clock: world.clock,
    libraryLock: new KeyedLock(),
  });

const AT = '2026-10-28T09:00:00.000Z';

/** The mentor's reading of a correction, in its reply format. */
function reading(kind: string, extra: Record<string, string> = {}) {
  return {
    kind,
    lesson: 'Overdue means unpaid and past its due date.',
    reason: 'The person states a rule the agent should always follow.',
    instruction:
      kind === 'procedure' || kind === 'source'
        ? 'Count an invoice as overdue only when it is unpaid and past due.'
        : '',
    question: kind === 'ambiguous' ? 'Overdue as of today, or as of the end of the month?' : '',
    taskType: 'overdue',
    ...extra,
  };
}

/**
 * A finished run whose graduate answered one question in the workspace: the person's request
 * and the reply, with its work kept. `request` is what the person asked.
 */
async function graduateWithChat(
  options: { sharing?: boolean; request?: string } = {},
): Promise<{ engine: Engine; graduateId: string; runId: string }> {
  world = await createWorld({
    job: {
      budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 60 },
      ...(options.sharing === false
        ? {}
        : { sharing: { remoteTraining: false, corrections: true } }),
    },
  });
  world.mentor.script = (request) =>
    request.json?.name === 'correction'
      ? reading('procedure')
      : hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
  const engine = open();
  const job = await engine.jobs.importFile(world.jobFile);
  const run = await engine.controller.start(job.id, 'architect', 7);
  await engine.controller.idle();
  const graduateId = engine.store.runs.get(run.id)?.run.graduateId;
  if (graduateId === undefined) throw new Error('The run made no graduate.');
  engine.store.chats.insert({
    id: 'cht_1',
    graduateId,
    title: 'Overdue invoices',
    createdAt: AT,
    updatedAt: AT,
    running: false,
    waiting: false,
    graduateVersion: 1,
  });
  const message = (patch: Partial<WorkspaceMessage>): WorkspaceMessage => ({
    id: 'msg_x',
    chatId: 'cht_1',
    role: 'user',
    createdAt: AT,
    text: '',
    steps: [],
    blocks: [],
    status: 'done',
    ...patch,
  });
  engine.store.messages.insert(
    message({ id: 'msg_1', text: options.request ?? 'Which invoices are overdue?' }),
  );
  engine.store.messages.insert(
    message({
      id: 'msg_2',
      role: 'agent',
      text: 'INV-1 and INV-2 are overdue.',
      graduateVersion: 1,
      trace: [
        {
          kind: 'model',
          text: 'Reading the invoices.',
          calls: [{ id: 'c1', name: 'read', arguments: '{"path":"data/jobs.csv"}' }],
        },
        {
          kind: 'tool',
          callId: 'c1',
          name: 'read',
          arguments: '{"path":"data/jobs.csv"}',
          result: '1\tid,tech,minutes\n2\tJ-1,T-3,90',
        },
        { kind: 'model', text: 'INV-1 and INV-2 are overdue.', calls: [] },
      ],
    }),
  );
  return { engine, graduateId, runId: run.id };
}

const correction: CorrectionRequest = {
  wrong: 'INV-1 was paid, so it is not overdue.',
  wanted: 'Only unpaid invoices past their due date.',
  consent: true,
};

/** Proposes and queues one lesson. */
async function queued(engine: Engine): Promise<Correction> {
  const teach = teachThis(engine);
  const proposed = await teach.propose('cht_1', 'msg_2', correction);
  return teach.queue(proposed.id);
}

describe('Teach this', () => {
  it('sends the mentor the whole exchange once the person agrees, and proposes a lesson', async () => {
    const { engine, graduateId } = await graduateWithChat();
    const before = world.mentor.requests.length;
    const proposed = await teachThis(engine).propose('cht_1', 'msg_2', correction);

    expect(proposed).toMatchObject({
      graduateId,
      version: 1,
      status: 'proposed',
      proposal: {
        kind: 'procedure',
        instruction: 'Count an invoice as overdue only when it is unpaid and past due.',
        taskType: 'overdue',
      },
      mentorModel: 'fake-mentor-1',
    });
    expect(proposed.proposal.question).toBeUndefined();
    expect(proposed.costUsd).toBeGreaterThan(0);
    expect(world.mentor.requests).toHaveLength(before + 1);
    const sent = world.mentor.requests.at(-1)?.messages[0]?.content ?? '';
    // The request, each call with its arguments and full result, the answer and the correction.
    expect(sent).toContain('Which invoices are overdue?');
    expect(sent).toContain('[turn 1] call read {"path":"data/jobs.csv"}');
    expect(sent).toContain('J-1,T-3,90');
    expect(sent).toContain('INV-1 and INV-2 are overdue.');
    expect(sent).toContain('INV-1 was paid, so it is not overdue.');
    expect(sent).toContain('Only unpaid invoices past their due date.');
    // Nothing from the job's tasks goes with it.
    expect(sent).not.toContain('[train]');
    expect(sent).not.toContain('[dev]');
    expect(engine.store.corrections.list(graduateId)).toEqual([proposed]);
  });

  it('sends nothing without consent, or when the job keeps corrections on this computer', async () => {
    const { engine, graduateId } = await graduateWithChat({ sharing: false });
    const before = world.mentor.requests.length;
    await expect(teachThis(engine).propose('cht_1', 'msg_2', correction)).rejects.toThrow(
      "Service desk keeps corrections on this computer. Allow sharing corrections with the mentor in the job's data settings to use Teach this.",
    );
    await engine.jobs.save({
      ...(await engine.jobs.get('service-desk')),
      sharing: { remoteTraining: false, corrections: true },
    });
    await expect(
      teachThis(engine).propose('cht_1', 'msg_2', { ...correction, consent: false }),
    ).rejects.toThrow(
      'Nothing was sent: the mentor reads this exchange only once you agree to share it.',
    );
    expect(world.mentor.requests).toHaveLength(before);
    expect(engine.store.corrections.list(graduateId)).toEqual([]);
  });

  it('refuses an exchange that carries a locked test task, and keeps nothing', async () => {
    const leaked = task('test', 'overdue', 1).prompt;
    const { engine, graduateId } = await graduateWithChat({ request: `Please do this: ${leaked}` });
    const before = world.mentor.requests.length;
    await expect(teachThis(engine).propose('cht_1', 'msg_2', correction)).rejects.toThrow(
      "Refused a mentor call: its payload matched 1 locked test task, in the person's request.",
    );
    expect(world.mentor.requests).toHaveLength(before);
    expect(engine.store.corrections.list(graduateId)).toEqual([]);
  });

  it('queues only what can be taught, and discards on request', async () => {
    const { engine } = await graduateWithChat();
    const teach = teachThis(engine);
    world.mentor.script = () => reading('ambiguous');
    const ambiguous = await teach.propose('cht_1', 'msg_2', correction);
    expect(ambiguous.proposal.instruction).toBeUndefined();
    expect(() => teach.queue(ambiguous.id)).toThrow(
      'The request was ambiguous, so there is nothing to teach yet: Overdue as of today, or as of the end of the month? Say what you meant and propose it again.',
    );
    world.mentor.script = () => reading('invalid');
    const invalid = await teach.propose('cht_1', 'msg_2', correction);
    expect(() => teach.queue(invalid.id)).toThrow(
      "The mentor couldn't check this correction against the exchange, so it can't be taught.",
    );
    expect(teach.discard(invalid.id).status).toBe('discarded');
    world.mentor.script = () => reading('weakness');
    const weakness = await teach.propose('cht_1', 'msg_2', correction);
    expect(teach.queue(weakness.id).status).toBe('queued');
    await expect(teach.apply(weakness.id)).rejects.toThrow(
      'Only a procedure or a source lesson can take effect as an instruction. Queue this one for Improve agent.',
    );
  });

  it('applies an instruction as a candidate version, and the active version stays', async () => {
    const { engine, graduateId } = await graduateWithChat();
    const teach = teachThis(engine);
    const lesson = await queued(engine);
    const applied = await teach.apply(lesson.id);

    expect(applied).toMatchObject({ status: 'applied', candidateVersion: 2 });
    expect(engine.store.graduates.get(graduateId)?.activeVersion).toBe(1);
    const version = engine.store.versions.get(graduateId, 2);
    expect(version).toMatchObject({ state: 'candidate', parent: 1, evaluation: 'unevaluated' });
    expect(version?.manifest.requirements.limitations).toContain(
      'No locked test measured this version.',
    );
    const instructions = await readFile(
      join(engine.paths.fromStored(version?.path ?? ''), 'harness', 'AGENTS.md'),
      'utf8',
    );
    expect(instructions).toContain('fix:invoice');
    expect(instructions).toContain(
      `${LESSONS_HEADING}\n- Count an invoice as overdue only when it is unpaid and past due.`,
    );
    await expect(teach.apply(lesson.id)).rejects.toThrow(
      "This lesson is applied, so it can't be applied again.",
    );
  });

  it('says who reads a flagged answer, at what cap, and the budget Improve agent keeps to', async () => {
    const { engine, graduateId } = await graduateWithChat({ sharing: false });
    const teach = teachThis(engine);
    const improve = {
      fromVersion: 1,
      budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 60 },
      training: false,
      waits: false,
    };
    expect(await teach.overview(graduateId, false)).toEqual({
      graduateId,
      correctionCapUsd: 0.25,
      sharesCorrections: false,
      mentor: 'Spark',
      improve,
    });
    expect((await teach.overview(graduateId, true)).improve).toEqual({ ...improve, waits: true });
    // A job's caps beyond what one improvement may be given are cut to its limits.
    await engine.jobs.save({
      ...(await engine.jobs.get('service-desk')),
      budget: { maxRounds: 40, maxMentorUsd: 250, maxWallMinutes: 600 },
    });
    expect((await teach.overview(graduateId, false)).improve?.budget).toEqual({
      maxRounds: 10,
      maxMentorUsd: 100,
      maxWallMinutes: 600,
    });
  });

  it('lets the job share flagged answers, and keep them here again, with no new contract', async () => {
    const { engine, graduateId } = await graduateWithChat({ sharing: false });
    const teach = teachThis(engine);
    const contracts = engine.store.contracts.list('service-desk').length;
    await teach.shareCorrections(graduateId, true);
    expect((await engine.jobs.get('service-desk')).sharing).toEqual({
      remoteTraining: false,
      corrections: true,
    });
    expect((await teach.overview(graduateId, false)).sharesCorrections).toBe(true);
    expect(engine.store.contracts.list('service-desk')).toHaveLength(contracts);
    expect((await teach.propose('cht_1', 'msg_2', correction)).status).toBe('proposed');

    await teach.shareCorrections(graduateId, false);
    const before = world.mentor.requests.length;
    await expect(teach.propose('cht_1', 'msg_2', correction)).rejects.toThrow(
      'Service desk keeps corrections on this computer.',
    );
    expect(world.mentor.requests).toHaveLength(before);
  });

  it("says why an agent from another computer can't be taught here", async () => {
    const { engine } = await graduateWithChat();
    engine.store.graduates.insert({
      id: 'grd_imported',
      runId: null,
      name: 'Returns desk',
      path: 'graduates/grd_imported',
      manifest: null,
      settings: null,
      activeVersion: null,
      createdAt: AT,
    });
    const teach = teachThis(engine);
    expect(await teach.overview('grd_imported', false)).toEqual({
      graduateId: 'grd_imported',
      correctionCapUsd: 0.25,
      sharesCorrections: false,
      unavailable: {
        reason: 'imported',
        message:
          "Returns desk came from another computer, so the job it learned from isn't here to teach it with.",
      },
    });
    await expect(teach.shareCorrections('grd_imported', true)).rejects.toThrow(
      'Returns desk came from a package, so this computer has no job to teach it with.',
    );
  });

  it('writes one version at a time when two lessons are applied at once', async () => {
    const { engine, graduateId } = await graduateWithChat();
    const teach = teachThis(engine);
    const first = await teach.propose('cht_1', 'msg_2', correction);
    const second = await teach.propose('cht_1', 'msg_2', correction);
    const applied = await Promise.all([teach.apply(first.id), teach.apply(second.id)]);

    expect(applied.map((item) => item.candidateVersion).sort()).toEqual([2, 3]);
    for (const version of [2, 3]) {
      const stored = engine.store.versions.get(graduateId, version);
      expect(await currentDigest(engine.paths.fromStored(stored?.path ?? ''))).toBe(stored?.digest);
    }
    expect(engine.store.graduates.get(graduateId)?.activeVersion).toBe(1);
  });
});

describe('Improve agent', () => {
  /** The improvement's mentor adds the overdue rule the person taught. */
  function improvingMentor() {
    world.mentor.script = (request) =>
      request.json?.name === 'correction'
        ? reading('weakness')
        : hypothesis('Teach the overdue rule', 'Service desk.\nfix:invoice\nfix:overdue');
  }

  it('makes a candidate version from the queued lessons, measured on dev, never touching the active one', async () => {
    const { engine, graduateId } = await graduateWithChat();
    improvingMentor();
    const lesson = await queued(engine);
    const testsBefore = world.runtime.sequence.filter((item) => item.startsWith('test:')).length;

    const start = await engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 });
    expect(start.started).toBe(true);
    expect(start.note).toBe(
      'Improving Service desk from version 1 with 1 lesson, within at most 1 round and $2.00 of mentor spend. Service desk keeps answering on version 1 meanwhile, and what this makes is a candidate you can accept and promote.',
    );
    await engine.controller.idle();

    expect(engine.errors).toEqual([]);
    const record = engine.store.runs.get(start.runId);
    expect(record?.run).toMatchObject({ status: 'finished', graduateId, method: 'architect' });
    expect(record?.improves).toEqual({ graduateId, version: 1, corrections: [lesson.id] });
    // The mentor saw the lesson beside the round's evidence.
    const diagnose = world.mentor.requests.at(-1)?.messages[0]?.content ?? '';
    expect(diagnose).toContain("# The person's lessons");
    expect(diagnose).toContain('- weakness (overdue): Overdue means unpaid and past its due date.');
    expect(diagnose).toContain('They said: INV-1 was paid, so it is not overdue.');
    // It started from version 1's harness, not the job's starting one.
    const first = engine.store.attempts.list({ runId: start.runId, split: 'dev', round: null });
    expect(first.filter((attempt) => attempt.check.pass)).toHaveLength(3);
    // A candidate of the same agent; the active version and the locked test are untouched.
    expect(engine.store.graduates.get(graduateId)?.activeVersion).toBe(1);
    expect(engine.store.graduates.list()).toHaveLength(1);
    expect(engine.store.versions.get(graduateId, 2)).toMatchObject({
      state: 'candidate',
      parent: 1,
      runId: start.runId,
      evaluation: 'unevaluated',
    });
    expect(world.runtime.sequence.filter((item) => item.startsWith('test:'))).toHaveLength(
      testsBefore,
    );
    expect(engine.store.corrections.get(lesson.id)).toMatchObject({
      status: 'used',
      candidateVersion: 2,
      runId: start.runId,
    });

    const [improvement] = await improvementsOf(engine.store, engine.jobs, graduateId);
    expect(improvement).toMatchObject({
      runId: start.runId,
      fromVersion: 1,
      status: 'finished',
      budget: { maxRounds: 1, maxMentorUsd: 2 },
      dev: { before: { pass: 6, total: 18 }, after: { pass: 12, total: 18 } },
      candidateVersion: 2,
      promotion: {
        allowed: true,
        reason:
          "Accept version 2, then promote it when you're ready. Its gain was measured on dev; no locked test measured it.",
      },
    });
    expect(improvement?.perType.find((type) => type.type === 'overdue')).toMatchObject({
      before: { pass: 0 },
      after: { pass: expect.any(Number) },
    });
    expect(improvement?.spentUsd).toBeGreaterThan(0);
    expect(improvement?.spentUsd).toBeLessThanOrEqual(2);
    // Its candidate never takes the locked test, by a re-test or with Spark as a reference.
    await expect(engine.controller.retest(start.runId, 'hosted')).rejects.toThrow(NO_LOCKED_TEST);
    await expect(engine.controller.reference(start.runId, 'test', 1)).rejects.toThrow(
      NO_LOCKED_TEST,
    );
  });

  it('sends no lesson once the job stops sharing corrections', async () => {
    const { engine, graduateId } = await graduateWithChat();
    improvingMentor();
    await queued(engine);
    await engine.jobs.save({
      ...(await engine.jobs.get('service-desk')),
      sharing: { remoteTraining: false, corrections: false },
    });
    const before = world.mentor.requests.length;
    await expect(
      engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 }),
    ).rejects.toThrow(
      "Service desk no longer shares corrections with the mentor, so Improve agent can't send it the lessons.",
    );
    expect(world.mentor.requests).toHaveLength(before);
  });

  it('teaches only the lessons still queued under it', async () => {
    const { engine, graduateId } = await graduateWithChat();
    improvingMentor();
    const teach = teachThis(engine);
    const kept = await teach.propose('cht_1', 'msg_2', correction);
    teach.queue(kept.id);
    const dropped = await teach.propose('cht_1', 'msg_2', {
      ...correction,
      wrong: 'It listed INV-9, which was written off.',
    });
    teach.queue(dropped.id);
    await engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 });
    // As if a discard had landed while the improvement was starting.
    const taken = engine.store.corrections.get(dropped.id);
    if (!taken) throw new Error('The lesson is gone.');
    engine.store.corrections.put({ ...taken, status: 'discarded' });
    await engine.controller.idle();

    const diagnose = world.mentor.requests.at(-1)?.messages[0]?.content ?? '';
    expect(diagnose).toContain('They said: INV-1 was paid, so it is not overdue.');
    expect(diagnose).not.toContain('INV-9');
    expect(engine.store.corrections.get(kept.id)?.status).toBe('used');
    expect(engine.store.corrections.get(dropped.id)?.status).toBe('discarded');
  });

  it('puts the lessons back in the queue when no change was kept', async () => {
    const { engine, graduateId } = await graduateWithChat();
    world.mentor.script = (request) =>
      request.json?.name === 'correction'
        ? reading('weakness')
        : hypothesis('Say it again', 'Service desk.\nfix:invoice\nPlease be careful.');
    const lesson = await queued(engine);
    const start = await engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 });
    await engine.controller.idle();

    expect(engine.store.runs.get(start.runId)?.run.status).toBe('finished');
    expect(engine.store.versions.list(graduateId)).toHaveLength(1);
    const back = engine.store.corrections.get(lesson.id);
    expect(back?.status).toBe('queued');
    expect(back?.runId).toBeUndefined();
    const [improvement] = await improvementsOf(engine.store, engine.jobs, graduateId);
    expect(improvement?.promotion).toEqual({
      allowed: false,
      reason: 'No change was kept, so there is nothing to promote.',
    });
  });

  it('waits its turn while another run holds the student, and says so', async () => {
    const { engine, graduateId } = await graduateWithChat();
    improvingMentor();
    await queued(engine);
    const other = await engine.controller.start('service-desk', 'bare', 3);
    const start = await engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 });
    expect(start.started).toBe(false);
    expect(start.note).toContain(
      'Another run is using the student on this computer, so this improvement waits for it and starts on its own',
    );
    expect(engine.store.runs.get(start.runId)?.run.status).toBe('queued');
    await engine.controller.idle();
    expect(engine.store.runs.get(other.id)?.run.status).toBe('finished');
    expect(engine.store.runs.get(start.runId)?.run.status).toBe('finished');
    await expect(
      engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 }),
    ).rejects.toThrow('Service desk has no queued lessons. Queue one with Teach this first.');
  });

  it('resumes after a crash and makes one candidate', async () => {
    const { engine: first, graduateId } = await graduateWithChat();
    improvingMentor();
    await queued(first);
    const crashed = deferred();
    let seen = 0;
    world.runtime.beforeAttempt = () => {
      seen += 1;
      if (seen !== 4) return;
      crashed.resolve();
      return new Promise<void>(() => {});
    };
    const start = await first.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 });
    await crashed.promise;
    first.store.close();
    engines.splice(engines.indexOf(first), 1);

    const second = open();
    world.runtime.beforeAttempt = undefined;
    expect(() =>
      teachThis(second).discard(second.store.corrections.list(graduateId)[0]?.id ?? ''),
    ).toThrow('An improvement is using this lesson. Stop it first.');
    second.controller.recover();
    await second.controller.idle();

    expect(second.errors).toEqual([]);
    expect(second.store.runs.get(start.runId)?.run.status).toBe('finished');
    expect(second.store.versions.list(graduateId).map((version) => version.version)).toEqual([
      1, 2,
    ]);
    expect(second.store.graduates.get(graduateId)?.activeVersion).toBe(1);
  });

  it('stops an improvement that keeps failing while it writes its candidate', async () => {
    const { engine, graduateId } = await graduateWithChat();
    improvingMentor();
    const lesson = await queued(engine);
    const harnessToFiles = world.deps.harness.harnessToFiles;
    // The candidate's folder can't be written, and every try fails the same way.
    world.deps.harness.harnessToFiles = (harness, options) => {
      if (options === undefined) throw new Error('There is no space left on the disk.');
      return harnessToFiles(harness, options);
    };
    const start = await engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 });
    await engine.controller.idle();
    expect(engine.store.runs.get(start.runId)?.run).toMatchObject({
      status: 'paused',
      phase: 'testing',
      error: 'There is no space left on the disk.',
    });
    await engine.controller.resume(start.runId);
    await engine.controller.idle();
    expect(engine.store.runs.get(start.runId)?.run.status).toBe('paused');

    await engine.controller.stop(start.runId);
    expect(engine.store.runs.get(start.runId)?.run).toMatchObject({
      status: 'stopped',
      phase: 'done',
      stopReason: 'user',
    });
    expect(engine.store.runs.get(start.runId)?.run.error).toBeUndefined();
    expect(engine.store.versions.list(graduateId)).toHaveLength(1);
    expect(engine.store.graduates.get(graduateId)?.activeVersion).toBe(1);
    const back = engine.store.corrections.get(lesson.id);
    expect(back?.status).toBe('queued');
    expect(back?.runId).toBeUndefined();
    const [stopped] = await improvementsOf(engine.store, engine.jobs, graduateId);
    expect(stopped).toMatchObject({
      status: 'stopped',
      promotion: {
        allowed: false,
        reason: 'It was stopped before it made a version, so there is nothing to promote.',
      },
    });
    expect(
      engine.events.some(
        (event) =>
          event.type === 'log' &&
          event.runId === start.runId &&
          event.message ===
            'Stopped before its version was written. Its lessons are back in the queue.',
      ),
    ).toBe(true);

    // Once the folder can be written, the same lesson makes a candidate.
    world.deps.harness.harnessToFiles = harnessToFiles;
    const again = await engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 });
    await engine.controller.idle();
    expect(engine.store.runs.get(again.runId)?.run.status).toBe('finished');
    expect(engine.store.versions.get(graduateId, 2)).toMatchObject({ state: 'candidate' });
    expect(engine.store.corrections.get(lesson.id)?.status).toBe('used');
    expect(engine.errors).toEqual([]);
  });

  it('stops an improvement during its rounds, and its lessons stay in the queue', async () => {
    const { engine, graduateId } = await graduateWithChat();
    improvingMentor();
    const lesson = await queued(engine);
    const reached = deferred();
    const release = deferred();
    let seen = 0;
    world.runtime.beforeAttempt = () => {
      seen += 1;
      if (seen !== 1) return;
      reached.resolve();
      return release.promise;
    };
    const start = await engine.controller.improve(graduateId, { maxRounds: 2, maxMentorUsd: 2 });
    await reached.promise;
    await engine.controller.stop(start.runId);
    expect(engine.store.runs.get(start.runId)?.run.status).toBe('stopping');
    release.resolve();
    await engine.controller.idle();

    expect(engine.store.runs.get(start.runId)?.run).toMatchObject({
      status: 'stopped',
      stopReason: 'user',
    });
    expect(engine.store.versions.list(graduateId)).toHaveLength(1);
    expect(engine.store.corrections.get(lesson.id)?.status).toBe('queued');
    expect(teachThis(engine).discard(lesson.id).status).toBe('discarded');
  });

  it('refuses an agent with nothing queued or one already being improved', async () => {
    const { engine, graduateId } = await graduateWithChat();
    improvingMentor();
    await expect(
      engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 }),
    ).rejects.toThrow('Service desk has no queued lessons. Queue one with Teach this first.');
    await queued(engine);
    const asks = await Promise.allSettled([
      engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 }),
      engine.controller.improve(graduateId, { maxRounds: 1, maxMentorUsd: 2 }),
    ]);
    expect(asks.map((ask) => ask.status)).toEqual(['fulfilled', 'rejected']);
    expect(asks[1]?.status === 'rejected' ? String(asks[1].reason) : '').toContain(
      'Service desk is already being improved. Wait for it, or stop it first.',
    );
    await engine.controller.idle();
  });
});
