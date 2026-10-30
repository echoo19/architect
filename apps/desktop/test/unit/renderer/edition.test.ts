import { describe, expect, it } from 'vitest';
import { parsePath } from '../../../src/renderer/src/lib/router';
import { EDITIONS, isLabOnly, placesOf } from '../../../src/renderer/src/shell/edition';

describe('editions', () => {
  it('name each one for the shell', () => {
    expect(EDITIONS.personal.name).toBe('Architect');
    expect(EDITIONS.lab.name).toBe('Architect Lab');
  });

  it('show the places only in the Lab', () => {
    expect(placesOf('personal')).toEqual([]);
    expect(placesOf('lab').map((place) => place.label)).toEqual([
      'Lab',
      'Fields',
      'Experiments',
      'Models',
      'Compute',
    ]);
  });

  it('send every Lab place home in the personal edition, and keep the flow and the agents', () => {
    for (const path of [
      '/fields',
      '/fields/job_1',
      '/experiments',
      '/experiments/new',
      '/experiments/exp_1',
      '/models',
      '/compute',
    ]) {
      expect(isLabOnly(parsePath(path)), path).toBe(true);
    }
    for (const path of [
      '/',
      '/welcome',
      '/new',
      '/import',
      '/agents/grd_1/chats/cht_1',
      '/jobs/job_1/define',
      '/runs/run_1/train',
      '/runs/run_1/report',
      '/runs/run_1/improvement',
      '/nowhere',
    ]) {
      expect(isLabOnly(parsePath(path)), path).toBe(false);
    }
  });
});
