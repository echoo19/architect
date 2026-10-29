import { join, resolve } from 'node:path';
import type { EngineApi } from '@architect/engine';
import { glimmerBuild, type DraftTurn, type Job } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { PickedPaths } from '../../../src/main/files/picked';
import { registerEngineHandlers } from '../../../src/main/handlers/engine';
import { applyChoices, type JobChoices } from '../../../src/main/jobs/choices';
import { defaultSettings } from '../../../src/main/settings/schema';
import { makeJob } from '../flow/factories';
import { routerHarness } from './router-harness';

const ROOT = resolve('/work');

/** What the person set up: Glimmer's 2-bit build and Spark, and a host connected. */
const CHOSEN: JobChoices = {
  mentor: defaultSettings().defaultMentor,
  student: { ...defaultSettings().defaultStudent, model: glimmerBuild('glimmer-gpu').model },
  keys: { openrouter: true },
};

function setup(choices: JobChoices = CHOSEN) {
  const { router, call } = routerHarness();
  const engine = {
    jobs: {
      list: vi.fn(async (): Promise<{ id: string }[]> => []),
      importFile: vi.fn(async () => makeJob({ id: 'job_1' })),
      createSample: vi.fn(async () => makeJob({ id: 'sample' })),
      save: vi.fn(async (job: Job) => job),
      draftStart: vi.fn(async (): Promise<DraftTurn> => ({
        sessionId: 's',
        message: '',
        options: [],
      })),
      draftReply: vi.fn(async (): Promise<DraftTurn> => ({
        sessionId: 's',
        message: '',
        options: [],
      })),
    },
    runs: { retest: vi.fn(async () => undefined) },
    reports: {
      get: vi.fn(async () => {
        throw new Error('This run has no report card yet.');
      }),
      list: vi.fn(async () => ['hosted', 'local']),
    },
  };
  const picked = new PickedPaths();
  registerEngineHandlers(
    router,
    (request) => request(engine as unknown as EngineApi),
    picked,
    async () => choices,
  );
  return { engine, picked, call };
}

describe('engine handlers', () => {
  it('forward requests and hand back what the engine answers', async () => {
    const { engine, call } = setup();
    expect(await call('jobs:list')).toEqual({ ok: true, value: [] });
    expect(engine.jobs.list).toHaveBeenCalledOnce();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await call('reports:get', 'run_1')).toEqual({
      ok: false,
      error: { message: 'This run has no report card yet.' },
    });
    errors.mockRestore();
  });

  it('pass on a re-test with the student endpoint it is for', async () => {
    const { engine, call } = setup();
    expect(await call('runs:retest', 'run_1', 'local')).toEqual({ ok: true, value: undefined });
    expect(engine.runs.retest).toHaveBeenCalledWith('run_1', 'local');
  });

  it('pass on which student endpoint a report card is asked for', async () => {
    const { engine, call } = setup();
    expect(await call('reports:list', 'run_1')).toEqual({ ok: true, value: ['hosted', 'local'] });
    expect(engine.reports.list).toHaveBeenCalledWith('run_1');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await call('reports:get', 'run_1', 'local');
    await call('reports:get', 'run_1');
    errors.mockRestore();
    expect(engine.reports.get.mock.calls).toEqual([
      ['run_1', 'local'],
      ['run_1', undefined],
    ]);
  });

  it('pass on only the files the user picked', async () => {
    const { engine, picked, call } = setup();
    const job = join(ROOT, 'downloads', 'job.json');

    const refused = await call('jobs:importFile', job);
    expect(refused.ok).toBe(false);
    expect(engine.jobs.importFile).not.toHaveBeenCalled();

    picked.add([job], 'files');
    expect(await call('jobs:importFile', job)).toMatchObject({ ok: true, value: { id: 'job_1' } });
    expect(engine.jobs.importFile).toHaveBeenCalledWith(job);
  });

  it('check the shape of path arguments before anything else', async () => {
    const { call } = setup();
    const result = await call('jobs:draftStart', 'Bill finished jobs', 'not-a-list');
    expect(!result.ok && result.error.message).toContain('Invalid arguments for jobs.draftStart');
  });

  describe('a new job takes what the person chose', () => {
    const wanted = (job: Job) => applyChoices(job, CHOSEN);

    it('starts the sample job with their teacher, model and hosted copy, and keeps that', async () => {
      const { engine, call } = setup();
      const result = await call('jobs:createSample');
      const expected = wanted(makeJob({ id: 'sample' }));
      expect(result).toEqual({ ok: true, value: expected });
      expect(engine.jobs.save).toHaveBeenCalledExactlyOnceWith(expected);
      expect(expected.student.local.model).toBe(glimmerBuild('glimmer-gpu').model);
      expect(expected.student.trainOn).toBe('hosted');
    });

    it('opens a sample job that already exists as it is', async () => {
      const { engine, call } = setup();
      engine.jobs.list.mockResolvedValue([{ id: 'sample' }]);
      const result = await call('jobs:createSample');
      expect(result).toEqual({ ok: true, value: makeJob({ id: 'sample' }) });
      expect(engine.jobs.save).not.toHaveBeenCalled();
    });

    it('does not save a sample job again when it already has what they chose', async () => {
      const { engine, call } = setup();
      engine.jobs.createSample.mockResolvedValue(wanted(makeJob({ id: 'sample' })));
      await call('jobs:createSample');
      expect(engine.jobs.save).not.toHaveBeenCalled();
    });

    it("starts an imported job file with theirs, whatever the file's author chose", async () => {
      const { engine, picked, call } = setup();
      const file = join(ROOT, 'downloads', 'job.json');
      picked.add([file], 'files');
      const result = await call('jobs:importFile', file);
      const expected = wanted(makeJob({ id: 'job_1' }));
      expect(result).toEqual({ ok: true, value: expected });
      expect(engine.jobs.save).toHaveBeenCalledExactlyOnceWith(expected);
    });

    it('fails an import the engine refuses, and saves nothing', async () => {
      const { engine, picked, call } = setup();
      const file = join(ROOT, 'downloads', 'notes.json');
      picked.add([file], 'files');
      engine.jobs.importFile.mockRejectedValue(new Error('That is not a job file.'));
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(await call('jobs:importFile', file)).toEqual({
        ok: false,
        error: { message: 'That is not a job file.' },
      });
      errors.mockRestore();
      expect(engine.jobs.save).not.toHaveBeenCalled();
    });

    it('starts a drafted job with theirs when the draft arrives, in either reply', async () => {
      const { engine, picked, call } = setup();
      const draft = makeJob({ id: 'drafted' });
      const turn: DraftTurn = { sessionId: 's', message: 'Here it is.', options: [], draft };
      engine.jobs.draftStart.mockResolvedValue(turn);
      engine.jobs.draftReply.mockResolvedValue(turn);
      const file = join(ROOT, 'office', 'jobs.csv');
      picked.add([file], 'files');

      const expected = { ...turn, draft: wanted(draft) };
      expect(await call('jobs:draftStart', 'Close out the day', [file])).toEqual({
        ok: true,
        value: expected,
      });
      expect(await call('jobs:draftReply', 's', 'Show the line items')).toEqual({
        ok: true,
        value: expected,
      });
      // A draft is saved only when the person reviews it, and then by the screen.
      expect(engine.jobs.save).not.toHaveBeenCalled();
    });

    it('passes a question from the drafter through untouched', async () => {
      const { engine, call } = setup();
      const question: DraftTurn = { sessionId: 's', message: 'Which tasks?', options: ['All'] };
      engine.jobs.draftReply.mockResolvedValue(question);
      expect(await call('jobs:draftReply', 's', 'Hello')).toEqual({ ok: true, value: question });
    });
  });
});
