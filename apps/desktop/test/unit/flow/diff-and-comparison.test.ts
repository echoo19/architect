import { describe, expect, it } from 'vitest';
import type { ReportCard } from '@architect/shared';
import {
  comparisonPeers,
  comparisonRows,
  formatPoints,
  methodExplanation,
} from '../../../src/renderer/src/flow/report/comparison';
import {
  countChanges,
  createsFile,
  lineCounts,
  parseUnifiedDiff,
  patchRows,
} from '../../../src/renderer/src/flow/train/diff';
import { at, makeRun } from './factories';

describe('parseUnifiedDiff', () => {
  const patch = [
    'diff --git a/AGENTS.md b/AGENTS.md',
    '--- a/AGENTS.md',
    '+++ b/AGENTS.md',
    '@@ -3,3 +3,4 @@ Operating rules',
    ' Read policy.md before pricing a job.',
    '-Round each line to the nearest dollar.',
    '+Work in integer cents.',
    '+Round only the final total.',
    '',
    '\\ No newline at end of file',
    '',
  ].join('\n');

  it('drops file headers and numbers each line', () => {
    expect(parseUnifiedDiff(patch)).toEqual([
      { kind: 'hunk', text: '@@ -3,3 +3,4 @@ Operating rules' },
      { kind: 'context', text: 'Read policy.md before pricing a job.', oldLine: 3, newLine: 3 },
      { kind: 'removed', text: 'Round each line to the nearest dollar.', oldLine: 4 },
      { kind: 'added', text: 'Work in integer cents.', newLine: 4 },
      { kind: 'added', text: 'Round only the final total.', newLine: 5 },
      { kind: 'context', text: '', oldLine: 5, newLine: 6 },
      { kind: 'note', text: 'No newline at end of file' },
    ]);
  });

  it('counts additions and removals, and reads Windows line endings', () => {
    expect(countChanges(parseUnifiedDiff(patch.replace(/\n/g, '\r\n')))).toEqual({
      added: 2,
      removed: 1,
    });
  });

  it('starts a preview at the first line, keeping later hunks as gaps', () => {
    const twoHunks = [
      '--- a/output/notes.md',
      '+++ b/output/notes.md',
      '@@ -1,2 +1,2 @@',
      '-Old title',
      '+New title',
      ' Kept',
      '@@ -40,1 +40,2 @@',
      ' Near the end',
      '+Added at the end',
      '',
    ].join('\n');
    expect(patchRows(twoHunks).map((line) => line.kind)).toEqual([
      'removed',
      'added',
      'context',
      'hunk',
      'context',
      'added',
    ]);
  });

  it('tells a new file apart, and counts its lines plainly', () => {
    const created =
      '--- /dev/null\n+++ b/output/visit.md\n@@ -0,0 +1,2 @@\n+# Visit\n+Bring a ladder.\n';
    expect(createsFile(created)).toBe(true);
    expect(lineCounts(created)).toBe('2 lines');
    expect(createsFile(patch)).toBe(false);
    expect(lineCounts(patch)).toBe('2 new lines · 1 line removed');
  });
});

function report(runId: string, method: ReportCard['method'], pass: number): ReportCard {
  return {
    jobId: 'job_desk',
    runId,
    method,
    name: 'Service desk',
    createdAt: at(0),
    student: { label: 'Glimmer', model: 'muse-glimmer:30b', runtime: 'ollama' },
    testedOn: 'local',
    mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
    test: {
      score: { pass, total: 60 },
      perType: [],
      latencyMs: { p50: 4000, p95: 7000 },
      refusals: 0,
      ranOffline: true,
    },
    dev: { baseline: null, final: null, curve: [] },
    cost: {
      mentorUsd: method === 'bare' ? 0 : 1.5,
      mentorInputTokens: 0,
      mentorOutputTokens: 0,
      rounds: method === 'architect' || method === 'self_reflection' ? 6 : 0,
      wallMs: 0,
    },
    refusedTypes: [],
    topInterventions: [],
    requirements: { passRate: { target: 0.9, actual: pass / 60, met: pass / 60 >= 0.9 } },
    overclaim: null,
  };
}

describe('comparison', () => {
  const finished = { status: 'finished' as const };
  const runs = [
    makeRun({ id: 'run_a', ...finished }),
    makeRun({ id: 'run_bare', method: 'bare', ...finished }),
    makeRun({ id: 'run_bare_old', method: 'bare', createdAt: at(-60), ...finished }),
    makeRun({ id: 'run_one', method: 'one_shot', ...finished }),
    makeRun({ id: 'run_self', method: 'self_reflection', status: 'running' }),
    makeRun({ id: 'run_other_seed', method: 'self_reflection', seed: 8, ...finished }),
    makeRun({ id: 'run_a_again', ...finished, createdAt: at(30) }),
  ];

  it('picks the newest finished run of every method on the same seed', () => {
    expect(comparisonPeers(runs, 'run_a').map((run) => run.id)).toEqual([
      'run_a',
      'run_one',
      'run_bare',
    ]);
  });

  it('has nothing to compare when no other method has finished', () => {
    expect(comparisonPeers([makeRun({ id: 'run_a', ...finished })], 'run_a')).toEqual([]);
    expect(comparisonPeers(runs, 'run_missing')).toEqual([]);
  });

  it('measures every method against the bare student', () => {
    const rows = comparisonRows(
      [
        report('run_bare', 'bare', 30),
        report('run_a', 'architect', 54),
        report('run_one', 'one_shot', 42),
      ],
      'run_a',
    );
    expect(rows.map((row) => [row.label, row.testRate, row.vsBare, row.current])).toEqual([
      ['Architect', 90, 40, true],
      ['One-time setup', 70, 20, false],
      ['No setup', 50, 0, false],
    ]);
  });

  it('writes the difference in percentage points', () => {
    expect(formatPoints(28.4)).toBe('+28 points');
    expect(formatPoints(-4)).toBe('\u22124 points');
    expect(formatPoints(1)).toBe('+1 point');
    expect(formatPoints(0.2)).toBe('0 points');
  });

  it('explains every method in one line with the job’s model names', () => {
    const names = { mentor: 'Spark', student: 'Glimmer' };
    expect(methodExplanation('bare', names)).toBe(
      'Glimmer on its own, with no instructions or skills',
    );
    expect(methodExplanation('one_shot', names)).toBe(
      'Spark wrote the setup once, without watching',
    );
    expect(methodExplanation('self_reflection', names)).toBe(
      'Glimmer corrected its own setup, with no help from Spark',
    );
    expect(methodExplanation('architect', names)).toBe('Spark taught Glimmer and kept what helped');
  });
});
