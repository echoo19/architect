import type { FieldExportRecord, Job } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { bundleBlocker, planFor } from '../../../src/renderer/src/compute/model';
import { latestExports } from '../../../src/renderer/src/fields/exports';

const GLIMMER_REPO = 'meta-models/Muse-Glimmer-30B';

/** A field's student as a job keeps it: its model here and, sometimes, an online copy. */
function job(local: string, hosted?: string): Pick<Job, 'name' | 'student'> {
  return {
    name: 'Academy desk',
    student: {
      local: {
        runtime: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: local,
        contextLength: 16_384,
      },
      ...(hosted === undefined
        ? {}
        : {
            hosted: {
              runtime: 'openai_compatible',
              baseUrl: 'https://openrouter.ai/api/v1',
              model: hosted,
              contextLength: 16_384,
            },
          }),
      trainOn: 'local',
    },
  } as Pick<Job, 'name' | 'student'>;
}

describe('planFor', () => {
  it("starts from the field's student, placed on Hugging Face", () => {
    expect(planFor('job_1', job('muse-glimmer:30b'))).toEqual({
      jobId: 'job_1',
      name: 'Academy desk',
      model: 'muse-glimmer:30b',
      repo: GLIMMER_REPO,
    });
  });

  it('places the online copy when the model here is unknown', () => {
    expect(planFor('job_1', job('acme:7b', 'meta/muse-glimmer-30b'))).toMatchObject({
      model: 'meta/muse-glimmer-30b',
      repo: GLIMMER_REPO,
    });
  });

  it('names the field and leaves the repository empty for a model it cannot place', () => {
    expect(planFor('job_1', job('acme:7b'))).toEqual({
      jobId: 'job_1',
      name: 'Academy desk',
      model: 'acme:7b',
      repo: null,
    });
  });

  it("takes a version's own model over the field's, even when the field can't be read", () => {
    expect(planFor('job_1', job('acme:7b'), 'muse-glimmer:30b-iq2')).toMatchObject({
      model: 'muse-glimmer:30b-iq2',
      repo: GLIMMER_REPO,
    });
    expect(planFor('job_1', null, 'muse-glimmer:30b')).toMatchObject({ name: null });
    expect(planFor('job_1', null)).toBeNull();
  });
});

const record = (jobId: string, dir: string, at: string): FieldExportRecord => ({
  jobId,
  name: jobId,
  dir,
  at,
});

describe('latestExports', () => {
  it("keeps each field's latest, newest first, ready only once chosen since the restart", () => {
    const recorded = [
      record('a', 'C:\\exports\\a-2', '2026-11-01T10:00:00.000Z'),
      record('b', 'C:\\exports\\b', '2026-11-01T09:00:00.000Z'),
      record('a', 'C:\\exports\\a-1', '2026-11-01T08:00:00.000Z'),
    ];
    const before = latestExports(recorded, { written: {}, chosen: [] });
    expect(before.map((item) => [item.jobId, item.dir, item.ready])).toEqual([
      ['a', 'C:\\exports\\a-2', false],
      ['b', 'C:\\exports\\b', false],
    ]);

    const after = latestExports(recorded, {
      written: { c: record('c', 'C:\\exports\\c', '2026-11-01T11:00:00.000Z') },
      chosen: ['C:\\exports\\b', 'C:\\exports\\c'],
    });
    expect(after.map((item) => [item.jobId, item.ready])).toEqual([
      ['c', true],
      ['a', false],
      ['b', true],
    ]);
  });
});

describe('bundleBlocker', () => {
  const read = { config: {}, model: { repo: 'lab/m', revision: 'a'.repeat(40) } };
  it('asks for an export recorded before a restart to be chosen again', () => {
    expect(
      bundleBlocker(read, true, { exportDir: 'C:\\x', exportReady: false, parentDir: 'C:\\y' }),
    ).toBe('Choose the field export again.');
    expect(
      bundleBlocker(read, true, { exportDir: 'C:\\x', exportReady: true, parentDir: 'C:\\y' }),
    ).toBeNull();
  });
});
