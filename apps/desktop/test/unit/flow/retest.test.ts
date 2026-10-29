import type { Retest } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { localTestTime, retestView } from '../../../src/renderer/src/flow/report/retest';

const STARTED = '2026-10-28T20:00:00.000Z';

function retest(overrides: Partial<Retest> = {}): Retest {
  return { target: 'local', status: 'testing', startedAt: STARTED, ...overrides };
}

describe("where a run's test on this computer stands", () => {
  it('can be started when it has not been', () => {
    expect(retestView(undefined, null)).toEqual({ phase: 'idle' });
    expect(retestView([], null)).toEqual({ phase: 'idle' });
  });

  it('is only the local test that counts, not one on the online copy', () => {
    expect(retestView([retest({ target: 'hosted', status: 'finished' })], null)).toEqual({
      phase: 'idle',
    });
  });

  it('is running, with how far it has got once a task has been scored', () => {
    expect(retestView([retest()], null)).toEqual({ phase: 'testing', done: null, total: null });
    expect(retestView([retest()], { done: 12, total: 60 })).toEqual({
      phase: 'testing',
      done: 12,
      total: 60,
    });
  });

  it('is stopped by an error, and says why', () => {
    expect(
      retestView([retest({ status: 'paused', error: 'Ollama is not running.' })], null),
    ).toEqual({ phase: 'paused', error: 'Ollama is not running.' });
    expect(retestView([retest({ status: 'paused' })], null)).toEqual({
      phase: 'paused',
      error: 'It stopped without saying why.',
    });
  });

  it('is finished once its card is filed, whatever progress was heard', () => {
    const finished = retest({ status: 'finished', endedAt: '2026-10-28T22:30:00.000Z' });
    expect(retestView([finished], { done: 60, total: 60 })).toEqual({ phase: 'finished' });
  });
});

describe('how long the test takes on this computer', () => {
  it('says so for the tasks of the final test', () => {
    expect(localTestTime(60)).toBe('About 2.5 hours for 60 tasks');
    expect(localTestTime(6)).toBe('About 15 minutes for 6 tasks');
    expect(localTestTime(1)).toBe('About 5 minutes for 1 task');
  });
});
