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
    for (const path of ['/runs/run_1', '/runs/run_1/train/extra', '/agents/g/chats', '/%E0%A4%A']) {
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
