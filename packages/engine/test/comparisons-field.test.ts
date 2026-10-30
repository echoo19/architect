import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StudyRecordSchema } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  runComparison,
  type ComparisonConfig,
  type ComparisonRequest,
} from '../src/comparisons';
import { armRun } from '../src/comparisons/report';
import { PROCEDURE_PATH } from '../src/drafting/study';
import { systemClock } from '../src/loop/deps';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { FileVersions, harnessToFiles } from './fakes/harness';
import { comparisonWorld, type ComparisonWorld } from './support/comparison-world';
import { BRIEF, fieldJob } from './support/field-comparison';

/*
 * A comparison on a job with organizations (decisions 068-070): the locked test holds the sealed
 * organizations' tasks as well as the test split, every arm's copy keeps them, Spark studies the
 * organizations once for the whole comparison and the person confirms its brief, and the report
 * gives each arm's results at each organization, seen or not, synthetic or real.
 */

const worlds: ComparisonWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const CONFIG: ComparisonConfig = {
  ...DEFAULT_CONFIG,
  arms: ['bare', 'draft'],
  caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, localMinutes: 0 },
  concurrency: 4,
};

function setUp() {
  const world = comparisonWorld({ clock: systemClock });
  worlds.push(world);
  const drafting = world.mentor.script;
  world.mentor.script = (request, call) =>
    request.json?.name === 'study_brief' ? BRIEF : drafting(request, call);
  const { dir, sealedTasks } = fieldJob(world);
  const request: ComparisonRequest = {
    jobDir: dir,
    out: world.out,
    config: CONFIG,
    models: DEFAULT_MODELS,
    confirm: true,
    planOnly: false,
  };
  return { world, request, sealedTasks };
}

const studyCalls = (world: ComparisonWorld) =>
  world.mentor.requests.filter((request) => request.json?.name === 'study_brief').length;

describe('a comparison on a job with organizations', () => {
  it('studies once, waits for the brief to be confirmed, and tests every arm on every organization', async () => {
    const { world, request, sealedTasks } = setUp();
    const lines: string[] = [];
    world.env.log = (line) => lines.push(line);

    // Without the brief's token nothing but calibration and the study is paid for.
    const waiting = await runComparison(request, world.env);
    expect(waiting.outcome).toBe('needs_confirmation');
    expect(studyCalls(world)).toBe(1);
    const studyFile = join(world.out, 'study.json');
    expect(existsSync(studyFile)).toBe(true);
    const brief = StudyRecordSchema.parse(JSON.parse(readFileSync(studyFile, 'utf8')));
    expect(brief.confirmedAt).toBeUndefined();
    const token = /--confirm-study (\S+)/.exec(lines.join('\n'))?.[1];
    expect(token).toBeDefined();
    // The locked test is priced at the test split and every sealed organization's task.
    const lockedTests = 36 + sealedTasks;
    expect(sealedTasks).toBeGreaterThan(0);
    const bare = waiting.report.projection?.arms.find((arm) => arm.arm === 'bare');
    expect(bare?.hostedAttempts).toBe(36 + lockedTests);

    // A stale token confirms nothing.
    await expect(
      runComparison({ ...request, studyToken: 'not-the-token' }, world.env),
    ).rejects.toThrow();

    const done = await runComparison({ ...request, studyToken: token ?? '' }, world.env);
    expect(done.outcome).toBe('finished');
    // The study was made once, for every arm.
    expect(studyCalls(world)).toBe(1);
    expect(
      StudyRecordSchema.parse(JSON.parse(readFileSync(studyFile, 'utf8'))).confirmedAt,
    ).toBeDefined();

    const hosted = done.report.backends.find((table) => table.backend === 'hosted');
    expect(hosted?.rows.map((row) => [row.arm, row.scenarios.total, row.complete])).toEqual([
      ['bare', lockedTests, true],
      ['draft', lockedTests, true],
    ]);
    for (const row of hosted?.rows ?? []) {
      // The target is judged on the organizations the arms trained on.
      expect(row.passTarget.of).toBe(36);
      const orgs = new Map<string, { seen: boolean; synthetic: boolean; total: number }>();
      for (const result of row.perOrg ?? []) {
        const before = orgs.get(result.org)?.total ?? 0;
        orgs.set(result.org, {
          seen: result.seen,
          synthetic: result.synthetic,
          total: before + result.total,
        });
      }
      expect(orgs.get('north')).toMatchObject({ seen: true, synthetic: true });
      expect(orgs.get('south')).toMatchObject({ seen: true, synthetic: true });
      expect(orgs.get('quayside')).toMatchObject({ seen: false, synthetic: true });
      expect(orgs.get('hillcrest')).toMatchObject({ seen: false, synthetic: false });
      const sealed = (orgs.get('quayside')?.total ?? 0) + (orgs.get('hillcrest')?.total ?? 0);
      expect(sealed).toBe(sealedTasks);
    }
    const markdown = readFileSync(join(world.out, 'report.md'), 'utf8');
    expect(markdown).toContain('Hillcrest Outlet (never seen, real)');
    expect(markdown).toContain('North Desk (trained on, synthetic)');
    // The study's cost is counted once, beside the arms'.
    const armsSpark = done.report.arms.reduce((sum, arm) => sum + arm.spent.sparkUsd, 0);
    expect(done.report.totals.sparkUsd).toBeCloseTo(armsSpark + brief.cost.usd, 10);

    // Each arm started from the same confirmed brief; the bare arm without its procedure.
    const paths = new DataPaths(join(world.out, 'data'));
    const store = openEngineStore(paths.database);
    try {
      const firstHarness: Record<string, string[]> = {};
      for (const arm of ['bare', 'draft'] as const) {
        const run = armRun(store, arm);
        if (run === null) throw new Error(`The ${arm} arm has no run.`);
        const shared = StudyRecordSchema.parse(
          JSON.parse(readFileSync(join(paths.jobDir(run.run.jobId), 'study.json'), 'utf8')),
        );
        expect(shared.brief).toEqual(brief.brief);
        expect(shared.confirmedAt).toBeDefined();
        const first = await new FileVersions(paths.harnessDir(run.run.jobId, run.run.id)).load(1);
        firstHarness[arm] = Object.keys(harnessToFiles(first));
      }
      expect(firstHarness['bare']).not.toContain(PROCEDURE_PATH);
      expect(firstHarness['draft']).toContain(PROCEDURE_PATH);
    } finally {
      store.close();
    }
  }, 300_000);
});
