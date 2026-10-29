import type { JobRun, JobSummary } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  TRAINING_ROW_WORDS,
  trainingRows,
  type TrainingRowKind,
} from '../../../src/renderer/src/shell/training-rows';

function job(latestRun: Partial<JobRun> | null, name = 'Service desk'): JobSummary {
  return {
    id: `job_${name}`,
    name,
    createdAt: '2026-10-28T12:00:00.000Z',
    taskCount: 170,
    ...(latestRun === null
      ? {}
      : {
          latestRun: {
            id: 'run_1',
            status: 'running',
            phase: 'attempting',
            method: 'architect',
            devCurrent: null,
            devBaseline: null,
            ...latestRun,
          },
        }),
  };
}

function kindOf(latestRun: Partial<JobRun>): TrainingRowKind | undefined {
  return trainingRows([job(latestRun)])[0]?.kind;
}

describe('the runs listed beside the agents', () => {
  it('lists a run while it trains, however it is being worked on', () => {
    for (const status of ['queued', 'running', 'stopping', 'testing'] as const) {
      expect(kindOf({ status })).toBe('training');
    }
  });

  it('lists a paused run, and says when it waits for an answer', () => {
    expect(kindOf({ status: 'paused' })).toBe('paused');
    expect(kindOf({ status: 'paused', phase: 'diagnosing' })).toBe('paused');
    expect(kindOf({ status: 'paused', phase: 'clarifying' })).toBe('question');
  });

  it('lists a finished run until its agent is accepted, and opens its results', () => {
    const [row] = trainingRows([job({ status: 'finished', phase: 'done', accepted: false })]);
    expect(row).toMatchObject({ kind: 'results', runId: 'run_1', path: '/runs/run_1/report' });
  });

  it('lists no finished run whose agent is accepted, has gone, or was never made', () => {
    expect(kindOf({ status: 'finished', phase: 'done', accepted: true })).toBeUndefined();
    expect(kindOf({ status: 'finished', phase: 'done' })).toBeUndefined();
  });

  it("lists no finished improvement: its version is looked at under the agent's Teaching", () => {
    expect(
      kindOf({ status: 'finished', phase: 'done', accepted: false, improves: true }),
    ).toBeUndefined();
  });

  it('lists a stopped or failed run, and opens the run to say what happened', () => {
    for (const status of ['stopped', 'failed'] as const) {
      const [row] = trainingRows([job({ status, phase: 'done' })]);
      expect(row).toMatchObject({
        kind: status,
        path: '/runs/run_1/train',
      });
    }
  });

  it('keeps a stopped or failed improvement too, since it was a run the person started', () => {
    expect(kindOf({ status: 'failed', phase: 'done', improves: true })).toBe('failed');
  });

  it('lists a job with no run at all as nothing, and every other job in its place', () => {
    const rows = trainingRows([
      job(null, 'Idle'),
      job({ id: 'run_a', status: 'running' }, 'First'),
      job({ id: 'run_b', status: 'finished', phase: 'done', accepted: true }, 'Done'),
      job({ id: 'run_c', status: 'failed', phase: 'done' }, 'Third'),
    ]);
    expect(rows.map((row) => [row.jobName, row.runId, row.kind])).toEqual([
      ['First', 'run_a', 'training'],
      ['Third', 'run_c', 'failed'],
    ]);
  });

  it('words each kind apart from the others', () => {
    const words = Object.values(TRAINING_ROW_WORDS);
    expect(new Set(words).size).toBe(words.length);
    expect(TRAINING_ROW_WORDS.results).toBe('Results ready');
  });
});
