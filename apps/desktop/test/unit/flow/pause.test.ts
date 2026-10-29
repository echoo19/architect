import {
  OLLAMA_BASE_URL,
  type Job,
  type LocalRuntimes,
  type Run,
  type StudentTarget,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { pauseProblems, type PauseFacts } from '../../../src/renderer/src/flow/train/pause';
import {
  initialLiveRunState,
  liveRunReducer,
  type LiveRun,
} from '../../../src/renderer/src/flow/train/run-state';
import { makeDetail, makeJob, makeRun } from './factories';

function paused(
  run: Partial<Run> = {},
  job: Job = makeJob(),
  lockedTestOn?: StudentTarget,
): LiveRun {
  const state = liveRunReducer(initialLiveRunState, {
    type: 'snapshot',
    detail: makeDetail({
      job,
      run: makeRun({ status: 'paused', error: 'It stopped.', ...run }),
      ...(lockedTestOn === undefined ? {} : { lockedTestOn }),
    }),
  });
  if (state.status !== 'live') throw new Error('The run did not load.');
  return state.live;
}

const MODEL = 'muse-glimmer:30b';

function local(options: { running?: boolean; models?: string[]; baseUrl?: string } = {}) {
  const { running = true, models = [MODEL], baseUrl = OLLAMA_BASE_URL } = options;
  return {
    ollama: { running, baseUrl, models: models.map((id) => ({ id })) },
    lmstudio: { running: false, baseUrl: 'http://127.0.0.1:1234', models: [] },
    gpu: null,
  } satisfies LocalRuntimes;
}

const facts = (overrides: Partial<PauseFacts> = {}): PauseFacts => ({
  keys: { meta: true, openrouter: true },
  local: local(),
  ...overrides,
});

const hostedJob = () =>
  makeJob({
    student: {
      label: 'Glimmer',
      trainOn: 'hosted',
      local: { runtime: 'ollama', baseUrl: OLLAMA_BASE_URL, model: MODEL, contextLength: 16_384 },
      hosted: {
        runtime: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'muse-glimmer-30b',
        contextLength: 16_384,
        secretRef: 'openrouter',
      },
    },
  });

describe('what a paused run needs before it can go on', () => {
  it('finds nothing wrong when the key is saved, Ollama runs and the model is downloaded', () => {
    expect(pauseProblems(paused(), facts())).toEqual([]);
  });

  it('says the teacher has no key, by its short name', () => {
    expect(pauseProblems(paused(), facts({ keys: { meta: false } }))).toEqual([
      { kind: 'key', text: 'Spark has no key saved.' },
    ]);
  });

  it('says Ollama is not running, for a student on this computer', () => {
    expect(pauseProblems(paused(), facts({ local: local({ running: false }) }))).toEqual([
      { kind: 'runtime', text: "Ollama isn't running, so Glimmer can't answer." },
    ]);
  });

  it('says the model is not downloaded, and which one, when Ollama runs without it', () => {
    expect(pauseProblems(paused(), facts({ local: local({ models: ['other:7b'] }) }))).toEqual([
      { kind: 'model', text: "Glimmer isn't downloaded on this computer.", model: MODEL },
    ]);
  });

  it('takes the same model under its short name as downloaded', () => {
    const job = makeJob({
      student: {
        label: 'Glimmer',
        trainOn: 'local',
        local: {
          runtime: 'ollama',
          baseUrl: OLLAMA_BASE_URL,
          model: 'muse-glimmer',
          contextLength: 16_384,
        },
      },
    });
    expect(
      pauseProblems(paused({}, job), facts({ local: local({ models: ['muse-glimmer:latest'] }) })),
    ).toEqual([]);
  });

  it('lists every problem at once, the teacher first', () => {
    const found = pauseProblems(
      paused(),
      facts({ keys: { meta: false }, local: local({ running: false }) }),
    );
    expect(found.map((problem) => problem.kind)).toEqual(['key', 'runtime']);
  });

  it('claims nothing about what has not been read yet', () => {
    expect(pauseProblems(paused(), { keys: null, local: null })).toEqual([]);
    expect(pauseProblems(paused(), facts({ keys: {} }))).toEqual([]);
  });

  it("looks at a hosted student's key while it practices online, and not at Ollama", () => {
    const run = paused({}, hostedJob());
    expect(
      pauseProblems(
        run,
        facts({ keys: { meta: true, openrouter: false }, local: local({ running: false }) }),
      ),
    ).toEqual([{ kind: 'key', text: 'The online Glimmer has no key saved.' }]);
  });

  it('looks at this computer for the final test, which runs without the teacher', () => {
    const run = paused({ phase: 'testing' }, hostedJob());
    expect(
      pauseProblems(
        run,
        facts({ keys: { meta: false, openrouter: false }, local: local({ running: false }) }),
      ),
    ).toEqual([{ kind: 'runtime', text: "Ollama isn't running, so Glimmer can't answer." }]);
  });

  it('leaves a student on another server alone, since the computer was not asked about it', () => {
    const job = makeJob({
      student: {
        label: 'Glimmer',
        trainOn: 'local',
        local: {
          runtime: 'ollama',
          baseUrl: 'http://127.0.0.1:9999',
          model: MODEL,
          contextLength: 16_384,
        },
      },
    });
    expect(pauseProblems(paused({}, job), facts({ local: local({ running: false }) }))).toEqual([]);
  });

  it('leaves a student that is not on Ollama alone', () => {
    const job = makeJob({
      student: {
        label: 'Glimmer',
        trainOn: 'local',
        local: {
          runtime: 'openai_compatible',
          baseUrl: 'http://127.0.0.1:1234/v1',
          model: MODEL,
          contextLength: 16_384,
        },
      },
    });
    expect(pauseProblems(paused({}, job), facts({ local: local({ running: false }) }))).toEqual([]);
  });
});

describe('a run that paused in its final test', () => {
  // Everything gone at once, so each case shows which endpoint was looked at.
  const nothing = facts({
    keys: { meta: false, openrouter: false },
    local: local({ running: false }),
  });
  const onlineKey = { kind: 'key', text: 'The online Glimmer has no key saved.' } as const;
  const ollamaOff = {
    kind: 'runtime',
    text: "Ollama isn't running, so Glimmer can't answer.",
  } as const;
  /** An agent that practiced here, with an online copy to take its final test on. */
  const practicedHere = () => makeJob({ student: { ...hostedJob().student, trainOn: 'local' } });

  it("looks at the online copy's key when the final test runs online, not at Ollama", () => {
    const run = paused({ phase: 'testing' }, hostedJob(), 'hosted');
    expect(pauseProblems(run, nothing)).toEqual([onlineKey]);
  });

  it('does the same for an agent that practiced on this computer', () => {
    const run = paused({ phase: 'testing' }, practicedHere(), 'hosted');
    expect(pauseProblems(run, nothing)).toEqual([onlineKey]);
  });

  it('does not tell an online final test to start Ollama when its key is saved', () => {
    const run = paused({ phase: 'testing' }, hostedJob(), 'hosted');
    expect(pauseProblems(run, facts({ local: local({ running: false }) }))).toEqual([]);
  });

  it('looks at this computer for a final test taken here, whatever practice used', () => {
    expect(pauseProblems(paused({ phase: 'testing' }, hostedJob(), 'local'), nothing)).toEqual([
      ollamaOff,
    ]);
    // A run that never said where its test runs takes it here.
    expect(pauseProblems(paused({ phase: 'testing' }, hostedJob()), nothing)).toEqual([ollamaOff]);
  });

  it('leaves where the final test will run out of the phases before it', () => {
    // Practicing on this computer, with the final test to come online: the online copy is not
    // asked for yet, and the teacher and this computer are.
    const practicing = paused({ phase: 'diagnosing' }, practicedHere(), 'hosted');
    expect(pauseProblems(practicing, facts({ keys: { meta: true, openrouter: false } }))).toEqual(
      [],
    );
    expect(pauseProblems(practicing, nothing)).toEqual([
      { kind: 'key', text: 'Spark has no key saved.' },
      ollamaOff,
    ]);
  });
});
