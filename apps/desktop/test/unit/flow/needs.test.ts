import {
  glimmerBuild,
  LMSTUDIO_BASE_URL,
  OLLAMA_BASE_URL,
  type Job,
  type LocalRuntimes,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  needsSummary,
  runNeeds,
  type RunNeedsInput,
} from '../../../src/renderer/src/flow/define/needs';
import { makeJob } from './factories';

const MODEL = 'muse-glimmer:30b';

function runtimes(running: boolean, models: string[] = []): LocalRuntimes {
  return {
    ollama: {
      running,
      baseUrl: OLLAMA_BASE_URL,
      models: models.map((id) => ({ id, sizeBytes: 1 })),
    },
    lmstudio: { running: false, baseUrl: LMSTUDIO_BASE_URL, models: [] },
    gpu: null,
  };
}

const copy = {
  runtime: 'openai_compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'meta/muse-glimmer-30b',
  secretRef: 'openrouter',
  contextLength: 16_384,
} as const;

/** A job that trains on this computer, and one that trains on the online copy. */
const here = makeJob();
const online = makeJob({
  student: { ...here.student, trainOn: 'hosted', hosted: copy },
});

/** Everything in place for a job that runs wholly on this computer. */
function input(overrides: Partial<RunNeedsInput> = {}): RunNeedsInput {
  return {
    job: here,
    testPlace: 'local',
    keys: { meta: true, openrouter: true },
    local: runtimes(true, [MODEL]),
    hostedProblem: null,
    token: 'found',
    ...overrides,
  };
}

const ids = (needs: { id: string }[]) => needs.map((need) => need.id);

describe('what a run needs before it starts', () => {
  it('needs nothing when the teacher has a key and the model is on this computer', () => {
    expect(runNeeds(input())).toEqual([]);
  });

  it("asks for the teacher's key, naming who issues it, and adds it in one step", () => {
    const [need, ...more] = runNeeds(input({ keys: { meta: false } }));
    expect(more).toEqual([]);
    expect(need).toMatchObject({
      id: 'teacher-key',
      title: 'Spark needs a Meta key',
      detail: 'It teaches your agent, and Meta bills your account for it.',
      label: 'Add a Meta key',
      action: { kind: 'add_key', provider: 'meta' },
    });
  });

  it('finds a teacher key that was never set, not only one set to false', () => {
    expect(ids(runNeeds(input({ keys: {} })))).toEqual(['teacher-key']);
  });

  it("opens the teacher's settings for a key of an endpoint the person added", () => {
    const added = makeJob({
      mentor: {
        kind: 'model',
        provider: 'other',
        label: 'Team model',
        baseUrl: 'https://llm.example.com/v1',
        model: 'team-1',
        reasoningEffort: 'medium',
        secretRef: 'custom:llm.example.com',
      },
    });
    const [need] = runNeeds(input({ job: added, keys: {} }));
    expect(need).toMatchObject({ label: 'Add its key', action: { kind: 'open', tab: 'mentor' } });
  });

  it('asks for no key of a teacher that runs on this computer', () => {
    const keyless = makeJob({
      mentor: {
        kind: 'model',
        provider: 'ollama',
        label: 'A local teacher',
        baseUrl: OLLAMA_BASE_URL,
        model: 'big',
        reasoningEffort: 'medium',
      },
    });
    expect(runNeeds(input({ job: keyless, keys: {} }))).toEqual([]);
  });

  it('waits while the keys are being read, and says so when they cannot be read', () => {
    expect(runNeeds(input({ keys: 'loading' }))).toEqual([]);
    const [need] = runNeeds(input({ keys: 'error' }));
    expect(need).toMatchObject({
      id: 'keys-unreadable',
      action: { kind: 'recheck', what: 'keys' },
    });
  });

  it('says nothing of unreadable keys to a run that uses none', () => {
    const keyless = makeJob({
      mentor: {
        kind: 'model',
        provider: 'ollama',
        label: 'A local teacher',
        baseUrl: OLLAMA_BASE_URL,
        model: 'big',
        reasoningEffort: 'medium',
      },
    });
    expect(runNeeds(input({ job: keyless, keys: 'error' }))).toEqual([]);
  });
});

describe('the model on this computer', () => {
  it('offers the download, with its size, when the model is not there yet', () => {
    const [need, ...more] = runNeeds(input({ local: runtimes(true, ['other-model']) }));
    expect(more).toEqual([]);
    expect(need).toMatchObject({
      id: 'model-missing',
      title: "Glimmer isn't on this computer yet",
      detail: 'Practice and the final test run on it. It downloads once.',
      label: 'Download · 17 GB',
      action: { kind: 'download', model: MODEL },
    });
  });

  it('sizes the download of the build the job uses', () => {
    const gpu = glimmerBuild('glimmer-gpu');
    const job = makeJob({
      student: { ...here.student, local: { ...here.student.local, model: gpu.model } },
    });
    const [need] = runNeeds(input({ job, local: runtimes(true) }));
    expect(need).toMatchObject({ label: 'Download · 14 GB', action: { model: gpu.model } });
  });

  it('knows a model is there under either of the names Ollama gives it', () => {
    const tagged = makeJob({
      student: { ...here.student, local: { ...here.student.local, model: 'muse-glimmer' } },
    });
    expect(
      runNeeds(input({ job: tagged, local: runtimes(true, ['muse-glimmer:latest']) })),
    ).toEqual([]);
  });

  it('says Ollama is not running before it says the model is missing', () => {
    const [need] = runNeeds(input({ local: runtimes(false) }));
    expect(need).toMatchObject({
      id: 'ollama-off',
      title: "Ollama isn't running",
      label: 'Check again',
      action: { kind: 'recheck', what: 'local' },
    });
  });

  it('names only what runs here: the final test when training is online', () => {
    const [need] = runNeeds(input({ job: online, local: runtimes(true) }));
    expect(need).toMatchObject({
      id: 'model-missing',
      detail: 'The final test runs on it. It downloads once.',
    });
  });

  it('names only practice when the final test is online', () => {
    const needs = runNeeds(
      input({ job: here, testPlace: 'hosted', local: runtimes(true), keys: { meta: true } }),
    );
    expect(needs.find((item) => item.id === 'model-missing')).toMatchObject({
      detail: 'Practice runs on it. It downloads once.',
    });
  });

  describe('when practice and the final test both run online', () => {
    const wholly = (local: RunNeedsInput['local']) =>
      runNeeds(input({ job: online, testPlace: 'hosted', local }));

    it('still needs the model on this computer, because the finished agent runs there', () => {
      const [need, ...more] = wholly(runtimes(true, ['other-model']));
      expect(more).toEqual([]);
      expect(need).toMatchObject({
        id: 'model-missing',
        title: "Glimmer isn't on this computer yet",
        detail:
          'The finished agent runs on it, so it has to be here when training ends. It downloads once.',
        label: 'Download · 17 GB',
        action: { kind: 'download', model: MODEL },
      });
    });

    it('says Ollama is not running before it says the model is missing', () => {
      const [need, ...more] = wholly(runtimes(false));
      expect(more).toEqual([]);
      expect(need).toMatchObject({ id: 'ollama-off', action: { kind: 'recheck', what: 'local' } });
    });

    it('needs nothing once the model is there', () => {
      expect(wholly(runtimes(true, [MODEL]))).toEqual([]);
    });

    it('waits while the computer is looked at, and says so when it cannot be', () => {
      expect(wholly('loading')).toEqual([]);
      expect(wholly('error')).toMatchObject([{ id: 'local-unknown' }]);
    });
  });

  it('waits while the computer is looked at, and says so when it cannot be', () => {
    expect(runNeeds(input({ local: 'loading' }))).toEqual([]);
    const [need] = runNeeds(input({ local: 'error' }));
    expect(need).toMatchObject({
      id: 'local-unknown',
      title: "Couldn't check whether Glimmer is on this computer",
      action: { kind: 'recheck', what: 'local' },
    });
  });

  it('leaves a runtime it was not looking at for the run to find out', () => {
    const elsewhere = makeJob({
      student: {
        ...here.student,
        local: { ...here.student.local, baseUrl: 'http://192.168.1.20:11434' },
      },
    });
    expect(runNeeds(input({ job: elsewhere, local: runtimes(false) }))).toEqual([]);
    const server = makeJob({
      student: {
        ...here.student,
        local: {
          runtime: 'openai_compatible',
          baseUrl: LMSTUDIO_BASE_URL,
          model: 'any',
          contextLength: 16_384,
        },
      },
    });
    expect(runNeeds(input({ job: server, local: runtimes(false) }))).toEqual([]);
  });
});

describe('the online copy', () => {
  const needsHost = (job: Job, rest: Partial<RunNeedsInput> = {}) =>
    runNeeds(input({ job, local: runtimes(true, [MODEL]), ...rest }));

  it('needs an online service when training online with none chosen', () => {
    const noCopy = makeJob({ student: { ...here.student, trainOn: 'hosted' } });
    const [need] = needsHost(noCopy);
    expect(need).toMatchObject({
      id: 'host-missing',
      title: 'The online copy needs a service',
      detail: 'Pick the online service that runs Glimmer.',
      label: 'Pick a service',
      action: { kind: 'open', tab: 'student' },
    });
    expect([need?.title, need?.detail, need?.label].join(' ')).not.toMatch(/\bhost\b/i);
  });

  it('needs an online service when only the final test is online', () => {
    const [need] = needsHost(here, { testPlace: 'hosted' });
    expect(need).toMatchObject({ id: 'host-missing' });
  });

  it("asks for the host's key, and adds it in one step", () => {
    const [need] = needsHost(online, { keys: { meta: true } });
    expect(need).toMatchObject({
      id: 'host-key',
      title: 'OpenRouter needs a key',
      detail: 'It runs Glimmer online and bills your account.',
      label: 'Add an OpenRouter key',
      action: { kind: 'add_key', provider: 'openrouter' },
    });
  });

  it("opens the agent's model for the key of a host the person added", () => {
    const added = makeJob({
      student: {
        ...online.student,
        hosted: {
          ...copy,
          baseUrl: 'https://gpu.example.com/v1',
          secretRef: 'custom:gpu.example.com',
        },
      },
    });
    const [need] = needsHost(added, { keys: { meta: true } });
    expect(need).toMatchObject({
      id: 'host-key',
      label: 'Add its key',
      action: { kind: 'open', tab: 'student' },
    });
  });

  it('needs nothing once the key is saved and the copy answers', () => {
    expect(needsHost(online)).toEqual([]);
  });

  it('says the copy did not answer, with the reason and the hint, and offers to try again', () => {
    const [need] = needsHost(online, {
      hostedProblem: { error: "OpenRouter doesn't offer this model.", hint: 'Pick another.' },
    });
    expect(need).toMatchObject({
      id: 'host-unreachable',
      title: "OpenRouter didn't answer",
      detail: "OpenRouter doesn't offer this model. Pick another.",
      label: 'Try again',
      action: { kind: 'recheck', what: 'host' },
    });
  });

  it('does not report an answer from a copy nothing is using', () => {
    expect(needsHost(here, { hostedProblem: { error: 'No route.' } })).toEqual([]);
  });

  it('leaves keys that are still being read to the keys', () => {
    expect(needsHost(online, { keys: 'loading' })).toEqual([]);
  });
});

describe('a teacher that may change nothing', () => {
  /** Only the weights and the questions are on, and a budget for training is set. */
  const weightsOnly = makeJob({
    interventions: ['weights', 'clarification'],
    budget: { ...here.budget, maxComputeUsd: 5 },
  });

  it('says so before the run, when only weights are on and the app knows they cannot run', () => {
    const [need, ...more] = runNeeds(input({ job: weightsOnly, token: 'none' }));
    expect(more).toEqual([]);
    expect(need).toEqual({
      id: 'teacher-idle',
      title: 'Spark has nothing it may change',
      detail:
        'Only retraining Glimmer itself is on, and it needs a Hugging Face key. Turn something else on, or add the key.',
      label: "Open Spark's settings",
      action: { kind: 'open', tab: 'mentor' },
    });
  });

  it('says what stops the weights, in the order the engine looks for it', () => {
    const noBudget = makeJob({ interventions: ['weights'] });
    const reason = (job: Job, extra: Partial<RunNeedsInput>) =>
      runNeeds(input({ job, ...extra })).find((need) => need.id === 'teacher-idle')?.detail;
    expect(reason(noBudget, { token: 'found' })).toContain(
      'it needs a training budget, and this job has none. Turn something else on.',
    );
    expect(reason(noBudget, { token: 'none' })).toContain('it needs a Hugging Face key');
    expect(reason(noBudget, { token: 'none', testPlace: 'hosted' })).toMatch(
      /it can't be done while the final test runs online\. Turn something else on, or run the final test on (this computer|your Mac)\./,
    );
  });

  it('leaves it to the run when the app cannot tell, or when the weights can run', () => {
    expect(runNeeds(input({ job: weightsOnly, token: 'unknown' }))).toEqual([]);
    expect(runNeeds(input({ job: weightsOnly, token: 'found' }))).toEqual([]);
  });

  it('is silent while a harness change is on, whatever keeps the weights from running', () => {
    for (const interventions of [
      ['procedure'],
      ['retrieval', 'weights'],
      ['helper', 'clarification'],
    ] as const) {
      const job = makeJob({ interventions: [...interventions] });
      expect(runNeeds(input({ job, token: 'none' }))).toEqual([]);
    }
    expect(runNeeds(input({ token: 'none' }))).toEqual([]);
  });

  it("comes after the teacher's key and before the model, and blocks like any other need", () => {
    const needs = runNeeds(
      input({ job: weightsOnly, token: 'none', keys: {}, local: runtimes(true) }),
    );
    expect(ids(needs)).toEqual(['teacher-key', 'teacher-idle', 'model-missing']);
    expect(needsSummary(needs)).toBe('Spark needs a Meta key, and 2 more');
  });
});

describe('everything missing at once', () => {
  it('lists the teacher, then the model on this computer, then the online copy', () => {
    const everything = makeJob({
      student: { ...here.student, trainOn: 'hosted', hosted: copy },
    });
    const needs = runNeeds({
      job: everything,
      testPlace: 'local',
      keys: {},
      local: runtimes(true),
      hostedProblem: null,
      token: 'found',
    });
    expect(ids(needs)).toEqual(['teacher-key', 'model-missing', 'host-key']);
  });
});

describe("the footer's line while something is missing", () => {
  it('names the first thing, and how many more wait', () => {
    const everything = makeJob({
      student: { ...here.student, trainOn: 'hosted', hosted: copy },
    });
    const needs = runNeeds({
      job: everything,
      testPlace: 'local',
      keys: {},
      local: runtimes(true),
      hostedProblem: null,
      token: 'found',
    });
    expect(needsSummary(needs)).toBe('Spark needs a Meta key, and 2 more');
    expect(needsSummary(needs.slice(0, 1))).toBe('Spark needs a Meta key');
    expect(needsSummary([])).toBe('');
  });
});
