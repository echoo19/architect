import {
  glimmerBuild,
  mentorPreset,
  OLLAMA_BASE_URL,
  OPENROUTER_BASE_URL,
  type AppSettings,
  type Job,
} from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  applyChoices,
  applyFileModels,
  currentChoices,
  type JobChoices,
} from '../../../src/main/jobs/choices';
import { defaultSettings } from '../../../src/main/settings/schema';
import { makeJob } from '../flow/factories';

const IQ2 = glimmerBuild('glimmer-gpu').model;

/** Setup as a person with a 12 GB card leaves it: the 2-bit build, Spark, no host connected. */
function choices(overrides: Partial<JobChoices> = {}): JobChoices {
  const settings = defaultSettings();
  return {
    mentor: settings.defaultMentor,
    student: { ...settings.defaultStudent, model: IQ2 },
    keys: {},
    endpoints: [],
    ...overrides,
  };
}

/** The sample job as it ships: Spark, the 4-bit build, no hosted copy. */
const sample = (): Job => makeJob();

describe('applyChoices', () => {
  it("gives a new job the person's model on this computer, by build, runtime and address", () => {
    const job = applyChoices(sample(), choices());
    expect(job.student.local).toEqual({
      runtime: 'ollama',
      baseUrl: OLLAMA_BASE_URL,
      model: IQ2,
      contextLength: 16_384,
    });
    expect(job.student.label).toBe('Glimmer');
  });

  it('follows a model that is not Glimmer, from another server, under its own name', () => {
    const job = applyChoices(
      sample(),
      choices({
        student: {
          runtime: 'openai_compatible',
          baseUrl: 'http://127.0.0.1:1234/v1',
          model: 'qwen3-30b',
          contextLength: 16_384,
        },
        keys: { openrouter: true },
      }),
    );
    expect(job.student.local).toMatchObject({
      runtime: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'qwen3-30b',
    });
    expect(job.student.label).toBe('qwen3-30b');
    // A hosted copy is a copy of Glimmer's weights; it would train some other model.
    expect(job.student.hosted).toBeUndefined();
    expect(job.student.trainOn).toBe('local');
  });

  it("gives it the person's teacher, with how hard they chose it to think", () => {
    const openrouter = {
      kind: 'model',
      provider: 'openrouter',
      label: 'Claude Sonnet 5.5',
      baseUrl: OPENROUTER_BASE_URL,
      model: 'anthropic/claude-sonnet-5-5',
      reasoningEffort: 'high',
      secretRef: 'openrouter',
    } as const;
    const job = applyChoices(sample(), choices({ mentor: openrouter }));
    expect(job.mentor).toEqual(openrouter);
  });

  it("keeps the job's own context size, the limit the agent is developed under", () => {
    const base = sample();
    const long = {
      ...base,
      student: { ...base.student, local: { ...base.student.local, contextLength: 32_768 } },
    };
    const job = applyChoices(long, choices());
    expect(job.student.local.contextLength).toBe(32_768);
  });

  it('adds the hosted copy of Glimmer and trains online once OpenRouter is connected', () => {
    const job = applyChoices(sample(), choices({ keys: { meta: true, openrouter: true } }));
    expect(job.student.hosted).toEqual({
      runtime: 'openai_compatible',
      baseUrl: OPENROUTER_BASE_URL,
      model: 'meta/muse-glimmer-30b',
      secretRef: 'openrouter',
      contextLength: 16_384,
    });
    expect(job.student.trainOn).toBe('hosted');
  });

  it('trains on this computer with no hosted copy when no host is connected', () => {
    const job = applyChoices(sample(), choices({ keys: { meta: true } }));
    expect(job.student.hosted).toBeUndefined();
    expect(job.student.trainOn).toBe('local');
  });

  it('uses another host that serves Glimmer when it is the only one connected', () => {
    const job = applyChoices(sample(), choices({ keys: { together: true } }));
    expect(job.student.hosted).toMatchObject({
      baseUrl: 'https://api.together.ai/v1',
      secretRef: 'together',
    });
    expect(job.student.trainOn).toBe('hosted');
  });

  it('prefers OpenRouter, which setup offers, when several hosts are connected', () => {
    const job = applyChoices(sample(), choices({ keys: { together: true, openrouter: true } }));
    expect(job.student.hosted?.secretRef).toBe('openrouter');
  });

  it("ignores a key that is saved as unset, and one that isn't a host's", () => {
    const job = applyChoices(sample(), choices({ keys: { openrouter: false, openai: true } }));
    expect(job.student.hosted).toBeUndefined();
  });

  it("drops the hosted copy a job file came with: where a person's files go is theirs to choose", () => {
    const base = sample();
    const theirs: Job = {
      ...base,
      student: {
        ...base.student,
        trainOn: 'hosted',
        hosted: {
          runtime: 'openai_compatible',
          baseUrl: 'https://api.together.ai/v1',
          model: 'meta-models/Muse-Glimmer-30B',
          secretRef: 'together',
          contextLength: 16_384,
        },
      },
    };
    const job = applyChoices(theirs, choices());
    expect(job.student.hosted).toBeUndefined();
    expect(job.student.trainOn).toBe('local');
  });

  it('changes nothing else about the job, and nothing in the job it was given', () => {
    const base = sample();
    const before = structuredClone(base);
    const job = applyChoices(base, choices({ keys: { openrouter: true } }));
    expect(base).toEqual(before);
    const { mentor: _mentor, student: _student, ...rest } = job;
    const { mentor: _was, student: _studied, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });

  it('gives the same job when applied again', () => {
    const wanted = choices({ keys: { openrouter: true } });
    const once = applyChoices(sample(), wanted);
    expect(applyChoices(once, wanted)).toEqual(once);
  });

  it('leaves a job that already has what the person chose exactly as it is', () => {
    const settings = defaultSettings();
    const wanted: JobChoices = {
      mentor: settings.defaultMentor,
      student: settings.defaultStudent,
      keys: {},
      endpoints: [],
    };
    const job = sample();
    expect(applyChoices(job, wanted)).toEqual(job);
  });
});

describe('currentChoices', () => {
  const settings = (patch: Partial<AppSettings> = {}) => ({
    get: () => ({ ...defaultSettings(), ...patch }),
  });

  it('reads the teacher and the model as Settings has them now, and the keys that are saved', () => {
    const mentor = mentorPreset('openai-gpt-6-luna');
    const read = currentChoices(
      settings({
        defaultMentor: {
          kind: 'model',
          provider: mentor.provider,
          label: mentor.label,
          baseUrl: mentor.baseUrl,
          model: mentor.model,
          reasoningEffort: 'low',
          secretRef: mentor.secretRef,
        },
      }),
      { status: () => ({ openai: true, openrouter: false }) },
    );
    expect(read.mentor).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'low' });
    expect(read.student.model).toBe(defaultSettings().defaultStudent.model);
    expect(read.keys).toEqual({ openai: true, openrouter: false });
  });

  it('makes a job all the same when the saved keys cannot be read, and says so in the log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const read = currentChoices(settings(), {
      status: () => {
        throw new Error("The saved keys can't be read.");
      },
    });
    expect(read.keys).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('reads the addresses of the endpoints the person added', () => {
    const read = currentChoices(
      settings({ customEndpoints: [{ baseUrl: CLUSTER, label: 'gpu-node-7:8000' }] }),
      { status: () => ({}) },
    );
    expect(read.endpoints).toEqual([CLUSTER]);
  });
});

const CLUSTER = 'http://gpu-node-7:8000/v1';

describe('applyFileModels', () => {
  const luna = mentorPreset('openai-gpt-6-luna');
  const fileMentor = {
    kind: 'model',
    provider: luna.provider,
    label: luna.label,
    baseUrl: luna.baseUrl,
    model: luna.model,
    reasoningEffort: 'high',
    secretRef: luna.secretRef,
  } as const;
  const onCluster = {
    runtime: 'openai_compatible',
    baseUrl: CLUSTER,
    model: 'qwen3-32b',
    contextLength: 16_384,
  } as const;
  /** A job file from a team on a cluster: their teacher, their model here, a copy on a node. */
  const theirs = (): Job => {
    const base = sample();
    return {
      ...base,
      mentor: fileMentor,
      student: {
        label: 'Qwen',
        local: { ...base.student.local, model: 'qwen3:32b' },
        trainOn: 'hosted',
        hosted: onCluster,
      },
    };
  };

  it('keeps every model the file names when each is connected here, and replaces none', () => {
    const imported = applyFileModels(
      theirs(),
      choices({ keys: { openai: true }, endpoints: [CLUSTER] }),
    );
    expect(imported.job).toEqual(theirs());
    expect(imported.replaced).toEqual([]);
  });

  it("replaces what isn't connected with the person's choices, and says what was replaced", () => {
    const imported = applyFileModels(theirs(), choices());
    expect(imported.job.mentor).toEqual(choices().mentor);
    // The model here stays, as it runs on this computer; the cluster copy wasn't added here.
    expect(imported.job.student.local.model).toBe('qwen3:32b');
    expect(imported.job.student.hosted).toBeUndefined();
    expect(imported.job.student.trainOn).toBe('local');
    expect(imported.replaced).toEqual([
      { role: 'mentor', from: luna.label, to: choices().mentor.label },
      { role: 'hosted', from: 'qwen3-32b', to: null },
    ]);
  });

  it('never sends a saved key to an address that is not its own', () => {
    const job = theirs();
    const stolen = { ...fileMentor, baseUrl: 'https://keys.example.com/v1' };
    const imported = applyFileModels(
      { ...job, mentor: stolen },
      choices({ keys: { openai: true }, endpoints: [CLUSTER] }),
    );
    expect(imported.job.mentor).toEqual(choices().mentor);
    expect(imported.replaced).toEqual([
      { role: 'mentor', from: luna.label, to: choices().mentor.label },
    ]);
  });

  it("runs the agent only on this computer: a model elsewhere is replaced with the person's", () => {
    const job = theirs();
    const elsewhere: Job = {
      ...job,
      student: { ...job.student, local: { ...onCluster, model: 'qwen3:32b' } },
    };
    const imported = applyFileModels(
      elsewhere,
      choices({ keys: { openai: true }, endpoints: [CLUSTER] }),
    );
    expect(imported.job.student.local).toMatchObject({ baseUrl: OLLAMA_BASE_URL, model: IQ2 });
    expect(imported.replaced).toContainEqual({ role: 'student', from: 'qwen3:32b', to: IQ2 });
  });

  it('says nothing when the file already names what the person chose', () => {
    const imported = applyFileModels(sample(), choices({ keys: { meta: true } }));
    expect(imported.replaced).toEqual([]);
    expect(imported.job).toEqual(sample());
  });
});
