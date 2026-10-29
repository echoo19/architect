import type { RunEvent } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { staleLists } from '../../../src/renderer/src/api/updates';
import { makeAttempt, makeRun, runUpdated } from '../flow/factories';

const attemptFinished = (runId: string): RunEvent => ({
  type: 'attempt.finished',
  runId,
  at: '2026-10-28T12:00:00.000Z',
  attempt: makeAttempt('att_1', { runId }),
});

describe('what an event from the engine makes stale', () => {
  it('reads the list of jobs again when a run changes status, once for each change', () => {
    const heard = new Map<string, string>();
    expect(staleLists(runUpdated(makeRun({ status: 'running' })), heard)).toEqual(['jobs']);
    // Every attempt moves the run's totals and says nothing new about its place in the list.
    expect(staleLists(runUpdated(makeRun({ status: 'running' })), heard)).toEqual([]);
    expect(staleLists(attemptFinished('run_1'), heard)).toEqual([]);
    expect(staleLists(runUpdated(makeRun({ status: 'paused' })), heard)).toEqual(['jobs']);
  });

  it('follows each run on its own', () => {
    const heard = new Map<string, string>();
    staleLists(runUpdated(makeRun({ id: 'run_a', status: 'running' })), heard);
    expect(staleLists(runUpdated(makeRun({ id: 'run_b', status: 'running' })), heard)).toEqual([
      'jobs',
    ]);
  });

  it('reads the list again when a run starts waiting for an answer, which is not a new status', () => {
    const heard = new Map<string, string>();
    staleLists(runUpdated(makeRun({ status: 'paused', phase: 'diagnosing' })), heard);
    expect(
      staleLists(runUpdated(makeRun({ status: 'paused', phase: 'clarifying' })), heard),
    ).toEqual(['jobs']);
  });

  it('reads the agents and the jobs again when a graduate is ready, which is a new agent', () => {
    const ready: RunEvent = {
      type: 'graduate.ready',
      runId: 'run_1',
      at: '2026-10-28T12:00:00.000Z',
      graduateId: 'grd_1',
    };
    expect(staleLists(ready, new Map())).toEqual(['graduates', 'jobs']);
  });

  it('leaves the lists alone for everything else a run says', () => {
    const log: RunEvent = {
      type: 'log',
      runId: 'run_1',
      at: '2026-10-28T12:00:00.000Z',
      level: 'info',
      message: 'Round 1 started.',
    };
    expect(staleLists(log, new Map())).toEqual([]);
  });
});
