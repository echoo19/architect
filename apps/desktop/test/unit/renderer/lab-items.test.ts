import type {
  Correction,
  GraduateSummary,
  Improvement,
  JobRun,
  JobSummary,
  OrgTypeResult,
  WorkspaceChat,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  approvalNeeds,
  finishedRuns,
  jobNeeds,
  orgScores,
  runningRuns,
  runWord,
  teachingNeeds,
} from '../../../src/renderer/src/lab/items';

function job(name: string, latestRun?: Partial<JobRun>): JobSummary {
  return {
    id: `job_${name}`,
    name,
    createdAt: '2026-10-28T12:00:00.000Z',
    taskCount: 120,
    ...(latestRun
      ? {
          latestRun: {
            id: `run_${name}`,
            status: 'running',
            phase: 'attempting',
            method: 'architect',
            devCurrent: null,
            devBaseline: null,
            ...latestRun,
          },
        }
      : {}),
  };
}

const agent = (patch: Partial<GraduateSummary> = {}) =>
  ({ id: 'grd_1', name: 'Phil', activeVersion: 1, ...patch }) as GraduateSummary;

describe('what needs the person', () => {
  it('lists a question, results nobody took yet, and an error, each opening its screen', () => {
    const needs = jobNeeds([
      job('Asks', { status: 'paused', phase: 'clarifying' }),
      job('Ready', { status: 'finished', phase: 'done', accepted: false }),
      job('Broke', { status: 'failed', phase: 'attempting' }),
      job('Taken', { status: 'finished', phase: 'done', accepted: true }),
      job('Improved', { status: 'finished', phase: 'done', accepted: false, improves: true }),
      job('Busy'),
      job('New'),
    ]);
    expect(needs.map((need) => [need.kind, need.title, need.target])).toEqual([
      ['question', 'Asks', { path: '/runs/run_Asks/train' }],
      ['results', 'Ready', { path: '/runs/run_Ready/report' }],
      ['failed', 'Broke', { path: '/runs/run_Broke/train' }],
    ]);
  });

  it('lists each chat that waits for an approval', () => {
    const chats = [
      { id: 'cht_1', title: 'Assign practice', waiting: true },
      { id: 'cht_2', title: 'Explain', waiting: false },
    ] as WorkspaceChat[];
    expect(approvalNeeds(agent(), chats)).toEqual([
      {
        key: 'approval:cht_1',
        kind: 'approval',
        title: 'Assign practice',
        detail: 'Phil waits for your approval',
        target: { path: '/agents/grd_1/chats/cht_1' },
      },
    ]);
  });

  it('counts proposed lessons, and offers a version only while it may be promoted', () => {
    const corrections = [
      { status: 'proposed' },
      { status: 'proposed' },
      { status: 'queued' },
    ] as Correction[];
    const improvement = (patch: Partial<Improvement>) =>
      ({
        runId: 'run_i',
        status: 'finished',
        fromVersion: 1,
        candidateVersion: 2,
        dev: { before: { pass: 75, total: 80 }, after: { pass: 70, total: 80 } },
        promotion: { allowed: true, reason: '' },
        ...patch,
      }) as Improvement;
    const needs = teachingNeeds(agent(), corrections, [improvement({})]);
    // Both scores, so a version that scored lower is never offered as the better one.
    expect(needs.map((need) => [need.kind, need.detail])).toEqual([
      ['lessons', '2 lessons to review'],
      ['promote', 'Version 2: 88% on check tasks, active version 1: 94%'],
    ]);
    // Started from another version: the active one's score isn't in this record.
    expect(
      teachingNeeds(agent({ activeVersion: 3 }), [], [improvement({ fromVersion: 1 })])[0]?.detail,
    ).toBe('Version 2: 88% on check tasks');
    expect(needs[0]?.target).toEqual({ teaching: 'grd_1' });
    for (const held of [
      improvement({ promotion: { allowed: false, reason: 'It lost a skill' } }),
      improvement({ status: 'running' }),
      improvement({ candidateVersion: undefined }),
    ]) {
      expect(teachingNeeds(agent(), [], [held])).toEqual([]);
    }
    expect(teachingNeeds(agent({ activeVersion: 2 }), [], [improvement({})])).toEqual([]);
  });
});

describe('runs', () => {
  it('counts a run as running until it ends, and a paused one unless it asks', () => {
    const jobs = [
      job('Queued', { status: 'queued' }),
      job('Testing', { status: 'testing', phase: 'testing' }),
      job('Paused', { status: 'paused', phase: 'diagnosing' }),
      job('Asks', { status: 'paused', phase: 'clarifying' }),
      job('Done', { status: 'finished', phase: 'done' }),
    ];
    expect(runningRuns(jobs).map((row) => row.jobName)).toEqual(['Queued', 'Testing', 'Paused']);
  });

  it('lists finished training runs, not improvements, up to a limit', () => {
    const jobs = [
      job('A', { status: 'finished', phase: 'done' }),
      job('B', { status: 'finished', phase: 'done', improves: true }),
      job('C', { status: 'finished', phase: 'done' }),
      job('D', { status: 'stopped', phase: 'attempting' }),
      job('E', { status: 'finished', phase: 'done' }),
    ];
    expect(finishedRuns(jobs, 2).map((row) => row.jobName)).toEqual(['A', 'C']);
  });

  it('says what a run is doing in a word or two', () => {
    expect(runWord({ status: 'running', phase: 'diagnosing' })).toBe('Diagnosing');
    expect(runWord({ status: 'paused', phase: 'diagnosing' })).toBe('Paused');
    expect(runWord({ status: 'testing', phase: 'testing' })).toBe('Final test');
  });
});

describe('a final test by kind of organization', () => {
  const result = (patch: Partial<OrgTypeResult>): OrgTypeResult => ({
    type: 'diagnose',
    label: 'Diagnose',
    org: 'a',
    orgName: 'A',
    seen: true,
    synthetic: true,
    pass: 1,
    total: 2,
    ...patch,
  });

  it('adds up the organizations it trained on, the generated and the real ones it never saw', () => {
    expect(
      orgScores([
        result({ org: 'a', pass: 3, total: 4 }),
        result({ org: 'b', pass: 2, total: 4 }),
        result({ org: 'u', seen: false, pass: 3, total: 5 }),
        result({ org: 'r', seen: false, synthetic: false, pass: 1, total: 3 }),
      ]),
    ).toEqual({
      seen: { pass: 5, total: 8 },
      unseen: { pass: 3, total: 5 },
      real: { pass: 1, total: 3 },
    });
  });

  it('leaves a kind with no tasks unmeasured, never a zero', () => {
    expect(
      orgScores([result({}), result({ seen: false, synthetic: false, total: 0, pass: 0 })]),
    ).toEqual({ seen: { pass: 1, total: 2 }, unseen: null, real: null });
  });
});
