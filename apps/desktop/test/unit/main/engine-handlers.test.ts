import { join, resolve } from 'node:path';
import type { EngineApi } from '@architect/engine';
import { mentorPreset, type MentorConfig } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { PickedPaths } from '../../../src/main/files/picked';
import { registerEngineHandlers } from '../../../src/main/handlers/engine';
import { routerHarness } from './router-harness';

const ROOT = resolve('/work');

/** The teacher the person chose in Settings. */
const TEACHER: MentorConfig = {
  kind: 'model',
  provider: 'openai',
  label: mentorPreset('openai-gpt-6-luna').label,
  baseUrl: mentorPreset('openai-gpt-6-luna').baseUrl,
  model: mentorPreset('openai-gpt-6-luna').model,
  reasoningEffort: 'low',
  secretRef: 'openai',
};

function setup() {
  const { router, call } = routerHarness();
  const turn = { sessionId: 'drf_1', message: 'Which region?', options: ['North', 'South'] };
  const engine = {
    jobs: {
      list: vi.fn(async () => []),
      importFile: vi.fn(async () => ({ id: 'job_1' })),
      draftStart: vi.fn(async () => turn),
      draftReply: vi.fn(async () => turn),
      taskPlan: vi.fn(async () => ({ source: 'generated' })),
      confirmRules: vi.fn(async () => ({ state: 'confirmed', token: 'abc' })),
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
  const settings = { get: () => ({ defaultMentor: TEACHER }) };
  registerEngineHandlers(
    router,
    (request) => request(engine as unknown as EngineApi),
    picked,
    settings as never,
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
    expect(await call('jobs:importFile', job)).toEqual({ ok: true, value: { id: 'job_1' } });
    expect(engine.jobs.importFile).toHaveBeenCalledWith(job);
  });

  it('carry the teacher chosen in Settings to the conversation that drafts a job, on every call', async () => {
    const { engine, picked, call } = setup();
    const files = [join(ROOT, 'office', 'orders.csv'), join(ROOT, 'office', 'policy.md')];
    picked.add(files, 'files');

    expect(await call('jobs:draftStart', 'Close out the day', files)).toMatchObject({ ok: true });
    expect(engine.jobs.draftStart).toHaveBeenCalledWith('Close out the day', files, TEACHER);
    expect(await call('jobs:draftReply', 'drf_1', 'North')).toMatchObject({ ok: true });
    expect(engine.jobs.draftReply).toHaveBeenCalledWith('drf_1', 'North', TEACHER);
  });

  it('draft a job only from files the user picked', async () => {
    const { engine, call } = setup();
    const refused = await call('jobs:draftStart', 'Close out the day', [
      join(ROOT, 'secrets', 'keys.csv'),
    ]);
    expect(refused.ok).toBe(false);
    expect(engine.jobs.draftStart).not.toHaveBeenCalled();
  });

  it('ask the engine what the tasks of a job are', async () => {
    const { engine, call } = setup();
    expect(await call('jobs:taskPlan', 'job_1')).toEqual({
      ok: true,
      value: { source: 'generated' },
    });
    expect(engine.jobs.taskPlan).toHaveBeenCalledWith('job_1');
  });

  it("pass the person's confirmation of a job's rules on to the engine, with what they saw", async () => {
    const { engine, call } = setup();
    expect(await call('jobs:confirmRules', 'job_1', 'abc')).toEqual({
      ok: true,
      value: { state: 'confirmed', token: 'abc' },
    });
    expect(engine.jobs.confirmRules).toHaveBeenCalledWith('job_1', 'abc');
  });

  it('check the shape of path arguments before anything else', async () => {
    const { call } = setup();
    const result = await call('jobs:draftStart', 'Bill finished jobs', 'not-a-list');
    expect(!result.ok && result.error.message).toContain('Invalid arguments for jobs.draftStart');
  });
});
