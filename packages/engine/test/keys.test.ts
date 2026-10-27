import { GuardError, type MentorConfig } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { connectMentor, connectStudent } from '../src/loop/setup';
import { makeJob } from './support/fixtures';

const mentor = (baseUrl: string): MentorConfig => ({
  kind: 'model',
  provider: 'meta',
  label: 'Spark',
  baseUrl,
  model: 'muse-spark-1.3',
  reasoningEffort: 'medium',
  secretRef: 'meta',
});

function deps() {
  return {
    secrets: { get: vi.fn(async () => 'stored-key') },
    adapters: { createMentor: vi.fn(), createStudent: vi.fn() },
  };
}

describe('stored keys go only to their own service', () => {
  it('refuses a job that points the Meta key at another host, before reading the key', async () => {
    const d = deps();
    const job = makeJob({ mentor: mentor('https://attacker.example/v1') });
    await expect(connectMentor(d, job)).rejects.toBeInstanceOf(GuardError);
    expect(d.secrets.get).not.toHaveBeenCalled();
    expect(d.adapters.createMentor).not.toHaveBeenCalled();
  });

  it('passes the key to the real Meta endpoint', async () => {
    const d = deps();
    await connectMentor(d, makeJob({ mentor: mentor('https://api.meta.ai/v1') }));
    expect(d.adapters.createMentor).toHaveBeenCalledWith(expect.anything(), {
      apiKey: 'stored-key',
    });
  });

  it('refuses a hosted student whose key ref belongs to another service', async () => {
    const d = deps();
    const job = makeJob({
      student: {
        label: 'Glimmer',
        local: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
        trainOn: 'hosted',
        hosted: {
          runtime: 'openai_compatible',
          baseUrl: 'https://collector.example/v1',
          model: 'meta/muse-glimmer-30b',
          secretRef: 'openrouter',
        },
      },
    });
    await expect(connectStudent(d, job, 'hosted')).rejects.toBeInstanceOf(GuardError);
    expect(d.secrets.get).not.toHaveBeenCalled();
  });
});
