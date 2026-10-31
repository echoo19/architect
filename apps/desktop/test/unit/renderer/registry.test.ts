import type { GraduateVersion, OrgTypeResult, ReportCard } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  comparable,
  compareScores,
  formatPoints,
  matchesFilter,
  matchesSearch,
  ordered,
  scoresOf,
  statusOf,
  type ModelRow,
} from '../../../src/renderer/src/models/registry';

interface RowSpec {
  agent?: string;
  name?: string;
  version: number;
  jobId?: string;
  active?: boolean;
  state?: GraduateVersion['state'];
  evaluation?: GraduateVersion['evaluation'];
  imported?: boolean;
  adapter?: boolean;
  quantization?: string;
  report?: ReportCard | null;
  createdAt?: string;
}

function rowOf(spec: RowSpec): ModelRow {
  const agent = spec.agent ?? 'grd_tutor';
  const version = {
    graduateId: agent,
    version: spec.version,
    state: spec.state ?? 'accepted',
    active: spec.active ?? false,
    evaluation: spec.evaluation ?? 'ready',
    ...(spec.imported ? { origin: { agentId: 'elsewhere', version: 1 } } : {}),
    createdAt: spec.createdAt ?? '2026-10-29T12:00:00.000Z',
    manifest: {
      contract: { jobId: spec.jobId ?? 'job_tutor', name: 'Tutor' },
      model: {
        label: 'Muse Glimmer',
        base: { name: 'muse-glimmer:30b', quantization: spec.quantization ?? 'Q4_K_M' },
        runtime: { compatible: ['ollama'] },
        ...(spec.adapter ? { adapter: { sha256: 'b84d27e'.padEnd(64, '0') } } : {}),
      },
      harness: { hash: '61b8a9d'.padEnd(64, '0') },
      evidence: {},
    },
  } as unknown as GraduateVersion;
  return {
    key: `${agent}:${spec.version}`,
    agent: { id: agent, name: spec.name ?? 'Tutor' } as ModelRow['agent'],
    version,
    report: spec.report ?? null,
    reportError: null,
  };
}

const result = (
  type: string,
  org: string,
  pass: number,
  total: number,
  where: { seen: boolean; synthetic: boolean },
): OrgTypeResult => ({
  type,
  label: type === 'hint' ? 'First hint' : 'Assign practice',
  org,
  orgName: org,
  pass,
  total,
  ...where,
});

const SEEN = { seen: true, synthetic: true };
const UNSEEN = { seen: false, synthetic: true };
const REAL = { seen: false, synthetic: false };

function report(perOrg: OrgTypeResult[], jobId = 'job_tutor', check = { pass: 64, total: 80 }) {
  return {
    jobId,
    test: { score: { pass: 0, total: 0 }, perType: [], perOrg },
    dev: { baseline: null, final: check, curve: [] },
  } as unknown as ReportCard;
}

describe('the registry of models', () => {
  it('names each version’s standing in one word, the active one first', () => {
    expect(statusOf(rowOf({ version: 1, active: true }).version)).toBe('active');
    expect(statusOf(rowOf({ version: 2, state: 'candidate', imported: true }).version)).toBe(
      'candidate',
    );
    expect(statusOf(rowOf({ version: 3, imported: true }).version)).toBe('imported');
    expect(statusOf(rowOf({ version: 4, evaluation: 'experimental' }).version)).toBe(
      'experimental',
    );
    expect(statusOf(rowOf({ version: 5, state: 'rejected' }).version)).toBe('set_aside');
    expect(statusOf(rowOf({ version: 6 }).version)).toBe('kept');
  });

  it('filters by standing and searches its words', () => {
    const imported = rowOf({ version: 2, state: 'candidate', imported: true });
    expect(matchesFilter(imported, 'candidates')).toBe(true);
    expect(matchesFilter(imported, 'imported')).toBe(true);
    expect(matchesFilter(imported, 'active')).toBe(false);
    const mini = rowOf({ version: 1, name: 'Tutor Mini', quantization: 'Q8_0' });
    expect(matchesSearch(mini, '8-bit mini')).toBe(true);
    expect(matchesSearch(mini, 'v1 61b8a9d')).toBe(true);
    expect(matchesSearch(mini, 'adapter')).toBe(false);
    expect(matchesSearch(mini, '   ')).toBe(true);
  });

  it('reads seen, unseen and real apart, the check tasks on their own, and nothing as zero', () => {
    const row = rowOf({
      version: 1,
      report: report([
        result('hint', 'north', 3, 4, SEEN),
        result('hint', 'harbor', 5, 6, UNSEEN),
        result('assign', 'real', 8, 10, REAL),
      ]),
    });
    expect(scoresOf(row)).toEqual({
      seen: { pass: 3, total: 4 },
      unseen: { pass: 5, total: 6 },
      real: { pass: 8, total: 10 },
      check: { pass: 64, total: 80 },
    });
    expect(scoresOf(rowOf({ version: 2 }))).toEqual({
      seen: null,
      unseen: null,
      real: null,
      check: null,
    });
  });

  it('compares two versions of one agent, or two agents of one job, older first', () => {
    const first = rowOf({ version: 1, createdAt: '2026-10-28T00:00:00.000Z' });
    const second = rowOf({ version: 2 });
    const mini = rowOf({ agent: 'grd_mini', version: 1, createdAt: '2026-10-27T00:00:00.000Z' });
    const other = rowOf({ agent: 'grd_desk', version: 1, jobId: 'job_desk' });
    expect(comparable(first, second)).toBe(true);
    expect(comparable(first, first)).toBe(false);
    expect(comparable(second, mini)).toBe(true);
    expect(comparable(first, other)).toBe(false);
    expect(ordered(second, first).map((row) => row.key)).toEqual([first.key, second.key]);
    expect(ordered(second, mini).map((row) => row.key)).toEqual([mini.key, second.key]);
  });

  it('sets results side by side only where both took the same tasks', () => {
    const before = rowOf({
      version: 1,
      report: report([
        result('hint', 'north', 2, 4, SEEN),
        result('assign', 'north', 4, 4, SEEN),
        result('hint', 'harbor', 4, 6, UNSEEN),
      ]),
    });
    const after = rowOf({
      version: 2,
      report: report([
        result('hint', 'north', 3, 4, SEEN),
        result('assign', 'north', 4, 4, SEEN),
        result('hint', 'harbor', 5, 7, UNSEEN),
        result('assign', 'real', 8, 10, REAL),
      ]),
    });
    const comparison = compareScores(before, after);
    if (comparison.kind !== 'compared') throw new Error('Expected a comparison');
    const { groups, rows, totals } = comparison.scores;
    expect(groups.map((group) => group.group)).toEqual(['seen', 'unseen', 'real']);
    // north, harbor, real
    expect(rows.find((row) => row.type === 'hint')?.cells).toEqual([
      { before: { pass: 2, total: 4 }, after: { pass: 3, total: 4 }, points: 25 },
      null,
      null,
    ]);
    expect(totals[0]).toEqual({
      before: { pass: 6, total: 8 },
      after: { pass: 7, total: 8 },
      points: 13,
    });
    // Harbor took a different number of tasks; the real academy only one of them took.
    expect(totals.slice(1)).toEqual([null, null]);

    const elsewhere = rowOf({ version: 3, report: report([], 'job_elsewhere') });
    expect(compareScores(before, elsewhere)).toEqual({
      kind: 'apart',
      reason: "They weren't measured on the same tasks.",
    });
    expect(compareScores(before, rowOf({ version: 4 }))).toEqual({
      kind: 'apart',
      reason: 'One of them took no final test.',
    });
  });

  it('writes a change in points with a true minus sign', () => {
    expect(formatPoints(8)).toBe('+8');
    expect(formatPoints(-3)).toBe('−3');
    expect(formatPoints(0)).toBe('0');
  });
});
