import { describe, expect, it } from 'vitest';
import { parsePath } from '../../../src/renderer/src/lib/router';
import {
  EDITIONS,
  inEdition,
  isLabOnly,
  placesOf,
  readsTeams,
} from '../../../src/renderer/src/shell/edition';

describe('editions', () => {
  it('know which routes read teams, which wait until the edition is known to be the Lab', () => {
    expect(readsTeams(parsePath('/teams/team_1/chats/cht_1'))).toBe(true);
    expect(readsTeams(parsePath('/models/teams'))).toBe(true);
    expect(readsTeams(parsePath('/models'))).toBe(false);
    expect(readsTeams(parsePath('/agents/grd_1/chats/cht_1'))).toBe(false);
  });

  it('name each one for the shell', () => {
    expect(EDITIONS.personal.name).toBe('Architect');
    expect(EDITIONS.lab.name).toBe('Architect Lab');
    expect(EDITIONS.wsp.name).toBe('Architect WSP');
    expect(EDITIONS.wsp.experimental).toBe(true);
    expect(EDITIONS.lab.experimental).toBeUndefined();
  });

  it('show the places only in the Lab, and WSP its experiments alone', () => {
    expect(placesOf('personal')).toEqual([]);
    expect(placesOf('wsp').map((place) => place.label)).toEqual(['Experiments']);
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
      '/models/teams',
      '/teams/team_1/chats/cht_1',
      '/compute',
      '/compute/fields/job_1',
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

  it('keep WSP to its own experiments, and its routes out of the other two', () => {
    for (const path of ['/', '/welcome', '/wsp/new', '/wsp/wsp-abc123', '/nowhere']) {
      expect(inEdition(parsePath(path), 'wsp'), path).toBe(true);
    }
    for (const path of [
      '/new',
      '/import',
      '/agents/grd_1',
      '/agents/grd_1/chats/cht_1',
      '/jobs/job_1/define',
      '/runs/run_1/train',
      '/fields',
      '/experiments',
      '/models',
      '/compute',
    ]) {
      expect(inEdition(parsePath(path), 'wsp'), path).toBe(false);
    }
    for (const edition of ['personal', 'lab'] as const) {
      expect(inEdition(parsePath('/wsp/new'), edition)).toBe(false);
      expect(inEdition(parsePath('/wsp/wsp-abc123'), edition)).toBe(false);
      expect(inEdition(parsePath('/new'), edition)).toBe(true);
    }
    expect(inEdition(parsePath('/models'), 'lab')).toBe(true);
    expect(inEdition(parsePath('/models'), 'personal')).toBe(false);
  });
});
