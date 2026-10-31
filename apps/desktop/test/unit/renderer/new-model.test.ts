import type { FieldView, GraduateVersion, Job, OrgTypeResult, ReportCard } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { newerVersion } from '../../../src/renderer/src/fields/TeachOn';
import { fieldTimeline, type TimelineRecords } from '../../../src/renderer/src/fields/timeline';
import { places } from '../../../src/renderer/src/flow/report/before-after';
import {
  changesModel,
  changeWords,
  orgChanges,
  versionModel,
} from '../../../src/renderer/src/models/model-change';

/*
 * Carrying a field to another model (decision 094) on screen: what the new model gains and loses
 * at each organization, each organization and skill before and after, the field's timeline in
 * both directions, and the newest version as the only one that moves on.
 */

const result = (
  type: string,
  org: string,
  pass: number,
  total: number,
  seen: boolean,
  synthetic = true,
): OrgTypeResult => ({
  type,
  label: type === 'hint' ? 'First hint' : 'Assign practice',
  org,
  orgName: org === 'cp' ? 'Real academy' : org === 'harbor' ? 'Harbor Learning' : 'Northside',
  pass,
  total,
  seen,
  synthetic,
});

function card(jobId: string, perOrg: OrgTypeResult[]): ReportCard {
  return { jobId, test: { perOrg } } as unknown as ReportCard;
}

const BEFORE = card('job_desk', [
  result('hint', 'north', 8, 10, true),
  result('assign', 'north', 6, 10, true),
  result('hint', 'harbor', 5, 10, false),
  result('assign', 'harbor', 5, 10, false),
  result('hint', 'cp', 7, 10, false, false),
]);
const AFTER = card('job_desk_v2', [
  result('hint', 'north', 9, 10, true),
  result('assign', 'north', 6, 10, true),
  result('hint', 'harbor', 7, 10, false),
  result('assign', 'harbor', 6, 10, false),
  result('hint', 'cp', 6, 10, false, false),
]);

function version(model: string, label: string): GraduateVersion {
  return {
    manifest: { model: { label, base: { name: model } } },
  } as unknown as GraduateVersion;
}

describe('what a switch to another model gains and loses', () => {
  it('compares each organization the same final test measured, across the two jobs', () => {
    expect(orgChanges(BEFORE, AFTER)).toEqual([
      expect.objectContaining({ name: 'Northside', group: 'seen', points: 5 }),
      expect.objectContaining({ name: 'Harbor Learning', group: 'unseen', points: 15 }),
      expect.objectContaining({ name: 'Real academy', group: 'real', points: -10 }),
    ]);
    // A cell measured on other tasks doesn't compare.
    const fewer = card('job_desk_v2', [result('hint', 'north', 4, 5, true)]);
    expect(orgChanges(BEFORE, fewer)).toEqual([]);
  });

  it('says a change in plain words and knows when the model changes', () => {
    expect(changeWords(5)).toBe('Gains 5 points');
    expect(changeWords(-1)).toBe('Loses 1 point');
    expect(changeWords(0)).toBe('No change');
    const glimmer = version('muse-glimmer:30b', 'Muse Glimmer');
    const qwen = version('qwen3:8b', 'Qwen3 8B');
    expect(changesModel(qwen, glimmer)).toBe(true);
    expect(changesModel(version('muse-glimmer:30b', 'Glimmer'), glimmer)).toBe(false);
    expect(versionModel(glimmer)).toBe('Glimmer');
    expect(versionModel(qwen)).toBe('Qwen3 8B');
  });
});

describe('before and after on a version carried to another model', () => {
  it('reads each organization and each of its skills in both versions', () => {
    const rows = places(BEFORE, AFTER, null, null, undefined);
    expect(rows.map((row) => row.name)).toEqual(['Northside', 'Harbor Learning', 'Real academy']);
    const harbor = rows[1];
    expect(harbor?.before).toBe('50% · 10 of 20, never seen');
    expect(harbor?.after).toBe('65% · 13 of 20, never seen');
    expect(harbor?.skills).toEqual([
      { type: 'hint', label: 'First hint', before: '50% · 5 of 10', after: '70% · 7 of 10' },
      {
        type: 'assign',
        label: 'Assign practice',
        before: '50% · 5 of 10',
        after: '60% · 6 of 10',
      },
    ]);
  });
});

const JOB = { id: 'job_desk', name: 'Academy desk', createdAt: '2026-10-27T09:00:00.000Z' } as Job;
const VIEW: FieldView = {
  jobId: JOB.id,
  organizations: [{ id: 'north', name: 'Northside', synthetic: true, files: [] }],
  sealed: [{ name: 'Harbor Learning', synthetic: true, files: 12 }],
  lockedTestTasks: 60,
};
const NONE: TimelineRecords = {
  study: undefined,
  counterexamples: [],
  versions: [],
  certifications: [],
  qualifications: [],
  experiments: [],
  laterVersions: [],
  exported: undefined,
};

describe("the field's timeline", () => {
  it('shows "Moved to" on the version carried and on the field it came from', () => {
    const moved = fieldTimeline(
      {
        job: { ...JOB, id: 'job_desk_v2', name: 'Academy desk v2' },
        view: {
          ...VIEW,
          jobId: 'job_desk_v2',
          versionOf: {
            jobId: JOB.id,
            name: 'Academy desk',
            version: 2,
            model: { from: 'Glimmer', to: 'Qwen3 8B' },
          },
        },
        runs: [],
        candidates: [],
      },
      NONE,
    );
    expect(moved.entries[0]).toMatchObject({
      stage: 'moved',
      word: 'Moved to Qwen3 8B',
      sentence:
        'Made as version 2 from Academy desk, carried from Glimmer to Qwen3 8B with its harness, lessons and tasks',
      link: { place: 'Field', to: { path: `/fields/${JOB.id}` } },
    });

    const earlier = fieldTimeline(
      { job: JOB, view: VIEW, runs: [], candidates: [] },
      {
        ...NONE,
        laterVersions: [
          {
            jobId: 'job_desk_v2',
            name: 'Academy desk v2',
            model: 'Qwen3 8B',
            at: '2026-10-31T09:00:00.000Z',
          },
        ],
      },
    );
    expect(earlier.entries[0]).toMatchObject({
      stage: 'moved',
      word: 'Moved to Qwen3 8B',
      sentence: 'Academy desk v2, a later version, was carried to Qwen3 8B',
      link: { place: 'Field', to: { path: '/fields/job_desk_v2' } },
    });
  });

  it('leads an older version to the newest, whatever made it', () => {
    expect(newerVersion(VIEW)).toBeNull();
    expect(
      newerVersion({
        ...VIEW,
        nextVersion: { jobId: 'job_desk_v2', name: 'Academy desk v2', model: 'Qwen3 8B' },
      }),
    ).toEqual({ jobId: 'job_desk_v2', name: 'Academy desk v2' });
  });
});
