import { allowedInterventions, type InterventionType, type Job } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TURNED_OFF } from '../src/loop/menu';
import { TRAINING_ENDED } from '../src/loop/run-state';
import { diagnosis, hypothesis } from './fakes/adapters';
import { FileVersions } from './fakes/harness';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';
import { withStandInTraining } from './support/training-world';

/*
 * What the person lets the mentor change (decision 063): each kind they turned off is refused
 * with the reason, in the menu the mentor is shown and in the plan it hands back, a first draft is
 * held to it as a round is, and a run whose mentor may change nothing stops before it asks.
 */

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

const ALL: InterventionType[] = ['procedure', 'retrieval', 'helper', 'weights', 'clarification'];

/** The words a refusal gives for what the mentor chose, as the runner says them. */
const CHOSE: Record<InterventionType, string> = {
  procedure: 'a procedure',
  retrieval: 'retrieval',
  helper: 'a helper',
  weights: 'to train the weights',
  clarification: 'to ask a question',
};

/** All five kinds of change but the ones named. */
function without(...off: InterventionType[]): InterventionType[] {
  return ALL.filter((type) => !off.includes(type));
}

async function setUp(job: Partial<Job>): Promise<void> {
  world = await createWorld({ job });
}

/** Starts the job as the app does, with someone there to answer, and waits for the run to end. */
async function run(engine: Engine, protocol?: Parameters<Engine['controller']['start']>[3]) {
  const job = await engine.jobs.importFile(world.jobFile);
  const started = await engine.controller.start(job.id, 'architect', 7, {
    interactive: true,
    ...protocol,
  });
  await engine.controller.idle();
  return started.id;
}

/** The kinds a request offers the mentor in its reply format. */
function offered(request: { json?: { schema: Record<string, unknown> } }): string[] {
  const schema = request.json?.schema as {
    properties: { intervention: { properties: { type: { enum: string[] } } } };
  };
  return schema.properties.intervention.properties.type.enum;
}

describe('a kind of change the job turned off', () => {
  it.each(ALL)(
    'is refused with the reason when the mentor picks %s, and is left out of what it is shown',
    async (off) => {
      await setUp({ interventions: without(off) });
      world.mentor.script = () =>
        diagnosis('Try the one that is off', {
          findings: [{ taskId: 'train-invoice-1' }],
          intervention: { type: off, question: off === 'clarification' ? 'Which invoices?' : '' },
        });
      const engine = open();
      const runId = await run(engine);

      // The person's choice is the reason given, whatever else would have refused it.
      const intervention = engine.store.interventions.get(runId, 1);
      expect(intervention?.status).toBe('invalid');
      expect(intervention?.invalidReason).toBe(
        `The mentor chose ${CHOSE[off]}, which this run can't do. ${TURNED_OFF}`,
      );
      const [experiment] = engine.store.experiments.list(runId);
      expect(experiment).toMatchObject({ round: 1, disposition: 'invalid', devAfter: null });

      // The mentor was told it is off, and the format it answers in does not offer it.
      const [request] = world.mentor.requests;
      expect(request?.system).toContain(`- ${off} is off the menu this round: ${TURNED_OFF}`);
      expect(offered(request ?? {})).not.toContain(off);
      expect(request?.messages.at(-1)?.content).not.toMatch(
        new RegExp(`Allowed this round:.*\\b${off}\\b`),
      );
    },
  );

  it('leaves the others on the menu, and gives a comparison its say on top', async () => {
    await setUp({ interventions: ['procedure', 'helper', 'clarification'] });
    world.mentor.script = () =>
      diagnosis('Anything', { findings: [{ taskId: 'train-invoice-1' }] });
    const engine = open();
    await run(engine);
    const [plain] = world.mentor.requests;
    expect(plain?.messages.at(-1)?.content).toContain(
      'Allowed this round: procedure, helper, clarification.',
    );
    expect(plain?.system).toContain(`- retrieval is off the menu this round: ${TURNED_OFF}`);

    // A comparison that fixes the menu narrows it further; what the job turned off stays off, with
    // the person's reason and not the comparison's.
    await engine.close();
    engines.length = 0;
    world.mentor.requests.length = 0;
    world.cleanup();
    await setUp({ interventions: ['procedure', 'helper', 'clarification'] });
    world.mentor.script = () =>
      diagnosis('Anything', { findings: [{ taskId: 'train-invoice-1' }] });
    const fixed = open();
    await run(fixed, {
      protocol: { arm: 'fixed', interventions: ['procedure', 'helper', 'retrieval'] },
    });
    const [narrowed] = world.mentor.requests;
    expect(narrowed?.messages.at(-1)?.content).toContain('Allowed this round: procedure, helper.');
    expect(narrowed?.system).toContain(`- retrieval is off the menu this round: ${TURNED_OFF}`);
    expect(narrowed?.system).toContain(
      "- clarification is off the menu this round: This run's comparison fixes the intervention to procedure or helper or retrieval, so the mentor doesn't choose it.",
    );
  });

  it('refuses worked examples when retrieval is off, since a retrieval rule loads them', async () => {
    await setUp({ interventions: without('retrieval') });
    world.mentor.script = () =>
      diagnosis('Show an invoice done right', {
        findings: [{ taskId: 'train-invoice-1' }],
        intervention: { workedExamples: ['invoice'] },
      });
    const engine = open();
    const runId = await run(engine);
    expect(engine.store.interventions.get(runId, 1)?.invalidReason).toBe(
      'Worked examples are loaded by a retrieval rule, and "What it reads when" is turned off for this job in the teacher\'s settings.',
    );
    expect(world.runtime.corrections).toEqual([]);
  });

  it('is also refused by what a change writes, whatever the mentor calls it', async () => {
    await setUp({ interventions: without('helper') });
    world.mentor.script = (_request, call) =>
      call === 1
        ? diagnosis('Count with a tool', {
            findings: [{ taskId: 'train-invoice-1' }],
            edits: [
              { op: 'write', path: 'AGENTS.md', content: 'Service desk.\nUse the sum tool.' },
              { op: 'write', path: 'tools/sum.js', content: 'function run() { return 1; }' },
              { op: 'write', path: 'tools/sum.json', content: '{}' },
            ],
          })
        : hypothesis('Say it in words', 'Service desk.\nfix:invoice');
    const engine = open();
    const runId = await run(engine);

    // The first reply is a procedure by its label and a tool by its files; the author is told so
    // and gets one fix, which writes no tool.
    const reason =
      'tools/sum.js needs "Small tools", which is turned off for this job in the teacher\'s settings.';
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(reason);
    const versions = new FileVersions(engine.paths.harnessDir('service-desk', runId));
    expect((await versions.load(2)).tools).toEqual([]);
    const taken = engine.store.interventions.get(runId, 1);
    expect(taken?.status).toBe('accepted');
    expect(taken?.edits.map((edit) => edit.path)).toEqual(['AGENTS.md']);
  });
});

describe('a first draft', () => {
  const blank: Partial<Job> = { startingHarness: { kind: 'blank' } };

  it('is told what the job turned off, and is not asked to write it', async () => {
    await setUp({ ...blank, interventions: without('helper') });
    world.mentor.script = () => hypothesis('A first harness', 'Service desk.\nfix:invoice');
    const engine = open();
    await run(engine);
    const [request] = world.mentor.requests;
    expect(request?.system).toContain(
      'Write a complete harness: AGENTS.md with the operating rules, a skill for each task type with the exact procedure, worked examples where the format is subtle, and retrieval rules that load the right skill for each request.',
    );
    expect(request?.system).not.toContain('tools for computations that are easy to get wrong');
    expect(request?.system).toContain(
      "The person turned off part of what you may change for this job, in the teacher's settings: Small tools. Do not write or delete tools/.",
    );
  });

  it('is held to it: a draft that writes a tool goes back with the reason', async () => {
    await setUp({ ...blank, interventions: without('helper') });
    world.mentor.script = (_request, call) =>
      call === 1
        ? hypothesis('A first harness', 'Service desk.', {
            edits: [
              { op: 'write', path: 'AGENTS.md', content: 'Service desk.' },
              { op: 'write', path: 'tools/sum.js', content: 'function run() { return 1; }' },
            ],
          })
        : hypothesis('A first harness', 'Service desk.\nfix:invoice');
    const engine = open();
    const runId = await run(engine);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(
      'tools/sum.js needs "Small tools", which is turned off for this job in the teacher\'s settings.',
    );
    expect(engine.store.rounds.get(runId, 1)?.round).toMatchObject({
      draft: true,
      decision: 'kept',
    });
    const versions = new FileVersions(engine.paths.harnessDir('service-desk', runId));
    expect((await versions.load(2)).tools).toEqual([]);
  });

  it('is written whole when nothing is turned off, as it always was', async () => {
    await setUp({ ...blank });
    world.mentor.script = () => hypothesis('A first harness', 'Service desk.\nfix:invoice');
    const engine = open();
    await run(engine);
    const [request] = world.mentor.requests;
    expect(request?.system).toContain(
      'Write a complete harness: AGENTS.md with the operating rules, a skill for each task type with the exact procedure, tools for computations that are easy to get wrong by hand, worked examples where the format is subtle, and retrieval rules that load the right skill for each request.',
    );
    expect(request?.system).not.toContain('The person turned off');
  });
});

describe('a mentor with nothing it may change', () => {
  it('stops the run before it asks for anything, and says why', async () => {
    // Only weights and questions are on, and this copy has no trainer.
    await setUp({ interventions: ['weights', 'clarification'] });
    const engine = open();
    const runId = await run(engine);

    const { run: stopped } = engine.store.runs.get(runId) ?? {};
    expect(stopped).toMatchObject({
      status: 'stopped',
      phase: 'done',
      stopReason: 'nothing_to_try',
    });
    expect(stopped?.error).toBe(
      "The mentor has nothing it may change in this run. Instructions and steps, What it reads when and Small tools are turned off for this job in the teacher's settings. Its weights: This copy of Architect has no trainer for weights. Change what it may change in the job's advanced settings, under Teacher, or set up what is missing, then start a new run.",
    );
    // No mentor call, no round, no baseline: nothing was spent.
    expect(world.mentor.requests).toEqual([]);
    expect(engine.store.rounds.list(runId)).toEqual([]);
    expect(engine.store.attempts.list({ runId })).toEqual([]);
    expect(stopped?.totals).toMatchObject({ rounds: 0, attempts: 0, mentorUsd: 0 });
    expect(stopped?.graduateId).toBeUndefined();
    expect(engine.errors).toEqual([]);
    expect(
      engine.events.some(
        (event) =>
          event.type === 'log' &&
          event.message.endsWith('There is no graduate to test.') &&
          event.message.startsWith('The mentor has nothing it may change'),
      ),
    ).toBe(true);
    // The sentence the run keeps for the person is the one the report words the stop with.
    expect(TRAINING_ENDED.nothing_to_try).toMatch(/nothing it may change/);
  });

  it('is not the case while weights can run here, with a blank start that needs no draft first', async () => {
    await setUp({ interventions: ['weights'], startingHarness: { kind: 'blank' } });
    withStandInTraining(world);
    world.mentor.script = () =>
      diagnosis('Train the invoice reading', {
        findings: [{ taskId: 'train-invoice-1' }],
        intervention: { type: 'weights' },
      });
    const engine = open();
    const runId = await run(engine);
    expect(engine.errors).toEqual([]);
    // The mentor was asked to diagnose, not to write a first harness it may not write.
    expect(world.mentor.requests[0]?.json?.name).toBe('diagnosis');
    const record = engine.store.runs.get(runId)?.run;
    expect(record?.stopReason).not.toBe('nothing_to_try');
    expect(engine.store.interventions.get(runId, 1)).toMatchObject({
      type: 'weights',
      status: 'accepted',
    });
    expect(engine.store.rounds.get(runId, 1)?.round.draft).toBeUndefined();
  });

  it('stops between rounds when what let it act goes away, keeping what the round before did', async () => {
    await setUp({
      interventions: ['weights'],
      budget: { maxRounds: 3, maxMentorUsd: 5, maxWallMinutes: 60 },
    });
    const { store: trainingStore } = withStandInTraining(world);
    void trainingStore;
    world.mentor.script = () =>
      diagnosis('Train the invoice reading', {
        findings: [{ taskId: 'train-invoice-1' }],
        intervention: { type: 'weights' },
      });
    const engine = open();
    // The trainer is set aside as soon as the first round has been decided.
    const training = world.deps.training;
    if (training === undefined) throw new Error('The world has no trainer.');
    const backend = training.backend.bind(training);
    let gone = false;
    training.backend = async () => (gone ? null : backend());
    engine.controller.onEvent((event) => {
      if (
        event.type === 'round.updated' &&
        event.round.index === 1 &&
        event.round.status === 'decided'
      ) {
        gone = true;
      }
    });
    const runId = await run(engine);

    const rounds = engine.store.rounds.list(runId);
    expect(rounds.map(({ round }) => round.index)).toEqual([1]);
    const ended = engine.store.runs.get(runId)?.run;
    expect(ended).toMatchObject({ status: 'stopped', stopReason: 'nothing_to_try' });
    expect(ended?.error).toContain('Its weights: No training backend is set up.');
    // Round 2 was never started, and the mentor was asked for round 1 only.
    expect(world.mentor.requests.length).toBeLessThanOrEqual(2);
    expect(engine.errors).toEqual([]);
  });

  it('holds the simpler methods of a comparison to it, and leaves the bare student alone', async () => {
    await setUp({ interventions: ['weights', 'clarification'] });
    const engine = open();
    const job = await engine.jobs.importFile(world.jobFile);
    // The one-shot guide writes a whole harness, which this job does not let anyone write.
    const guide = await engine.controller.start(job.id, 'one_shot', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(guide.id)?.run).toMatchObject({
      status: 'stopped',
      stopReason: 'nothing_to_try',
    });
    // The bare student never asks the mentor for anything, so there is nothing to refuse it.
    const bare = await engine.controller.start(job.id, 'bare', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(bare.id)?.run.status).toBe('finished');
    expect(world.mentor.requests).toEqual([]);
    expect(engine.errors).toEqual([]);
  });

  it('is no new version of the job, which a graduate promises, when the choice changes', async () => {
    await setUp({});
    const engine = open();
    const job = await engine.jobs.importFile(world.jobFile);
    const versions = engine.store.contracts.list(job.id).length;
    await engine.jobs.save({ ...job, interventions: ['procedure', 'weights'] });
    expect((await engine.jobs.get(job.id)).interventions).toEqual(['procedure', 'weights']);
    expect(engine.store.contracts.list(job.id)).toHaveLength(versions);
    // Saving what the engine would refuse changes nothing.
    await expect(engine.jobs.save({ ...job, interventions: ['clarification'] })).rejects.toThrow(
      /Keep at least one way to change the agent/,
    );
    expect((await engine.jobs.get(job.id)).interventions).toEqual(['procedure', 'weights']);
  });

  it('is the same for a job that allows everything: nothing changes for a job that never chose', async () => {
    await setUp({});
    world.mentor.script = (_request, call) =>
      [hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice')][call - 1] ??
      hypothesis('Nothing more', 'Service desk.\nfix:invoice\nAgain.');
    const engine = open();
    const runId = await run(engine);
    expect(engine.store.runs.get(runId)?.run.stopReason).not.toBe('nothing_to_try');
    expect(allowedInterventions(await engine.jobs.get('service-desk'))).toEqual(ALL);
  });
});
