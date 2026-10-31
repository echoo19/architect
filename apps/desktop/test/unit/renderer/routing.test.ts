import { describe, expect, it } from 'vitest';
import { parsePath, pathFromHash, paths } from '../../../src/renderer/src/lib/router';
import { matchShortcut } from '../../../src/renderer/src/lib/shortcuts';

describe('parsePath', () => {
  it('reads every route', () => {
    expect(parsePath('/')).toEqual({ name: 'home' });
    expect(parsePath('/welcome')).toEqual({ name: 'welcome' });
    expect(parsePath('/new')).toEqual({ name: 'new' });
    expect(parsePath('/import')).toEqual({ name: 'import' });
    expect(parsePath(paths.importAgent())).toEqual({ name: 'import' });
    expect(parsePath('/agents/grd_1/chats/cht_2')).toEqual({
      name: 'chat',
      graduateId: 'grd_1',
      chatId: 'cht_2',
    });
    expect(parsePath('/jobs/job_1/define')).toEqual({ name: 'define', jobId: 'job_1' });
    expect(parsePath('/runs/run_1/train')).toEqual({ name: 'train', runId: 'run_1' });
    expect(parsePath('/runs/run_1/report')).toEqual({ name: 'report', runId: 'run_1' });
    expect(parsePath(paths.improvement('run_1'))).toEqual({ name: 'improvement', runId: 'run_1' });
  });

  it("reads Architect's places", () => {
    expect(parsePath(paths.home())).toEqual({ name: 'home' });
    expect(parsePath(paths.fields())).toEqual({ name: 'fields' });
    expect(parsePath(paths.field('job_1'))).toEqual({ name: 'field', jobId: 'job_1' });
    expect(parsePath(paths.experiments())).toEqual({ name: 'experiments' });
    expect(parsePath(paths.newExperiment())).toEqual({ name: 'experiment-new' });
    expect(parsePath(paths.newExperiment('job_1'))).toEqual({
      name: 'experiment-new',
      jobId: 'job_1',
    });
    expect(parsePath(paths.experiment('exp_1'))).toEqual({
      name: 'experiment',
      experimentId: 'exp_1',
    });
    expect(parsePath(paths.models())).toEqual({ name: 'models' });
    expect(parsePath(paths.models('grd_1:2'))).toEqual({ name: 'models', open: 'grd_1:2' });
    expect(parsePath(paths.compute())).toEqual({ name: 'compute' });
  });

  it('round-trips ids through the path builders', () => {
    const id = 'job with/odd #chars';
    expect(parsePath(paths.define(id))).toEqual({ name: 'define', jobId: id });
    expect(parsePath(paths.chat('a/b', 'c?d'))).toEqual({
      name: 'chat',
      graduateId: 'a/b',
      chatId: 'c?d',
    });
  });

  it('sends anything else to not found', () => {
    for (const path of [
      '/runs/run_1',
      '/runs/run_1/train/extra',
      '/agents/g/chats',
      '/%E0%A4%A',
      '/fields/job_1/extra',
      '/models/m_1/extra',
      '/compute/x',
    ]) {
      expect(parsePath(path)).toEqual({ name: 'not-found', path });
    }
  });
});

describe('pathFromHash', () => {
  it('turns a location hash into a path', () => {
    expect(pathFromHash('')).toBe('/');
    expect(pathFromHash('#/new')).toBe('/new');
    expect(pathFromHash('#new')).toBe('/new');
  });
});

describe('matchShortcut', () => {
  const press = (
    key: string,
    mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>>,
  ) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it('uses Command on macOS and Ctrl elsewhere', () => {
    expect(matchShortcut(press('k', { metaKey: true }), true)).toBe('palette');
    expect(matchShortcut(press('k', { ctrlKey: true }), true)).toBeNull();
    expect(matchShortcut(press('K', { ctrlKey: true }), false)).toBe('palette');
    expect(matchShortcut(press('k', { metaKey: true }), false)).toBeNull();
  });

  it('maps N to a new agent and comma to settings', () => {
    expect(matchShortcut(press('n', { ctrlKey: true }), false)).toBe('new-agent');
    expect(matchShortcut(press(',', { metaKey: true }), true)).toBe('settings');
  });

  it('ignores chords with extra modifiers or other keys', () => {
    expect(matchShortcut(press('k', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(matchShortcut(press('k', { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(matchShortcut(press('j', { ctrlKey: true }), false)).toBeNull();
    expect(matchShortcut(press('k', {}), false)).toBeNull();
  });
});
