import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComparisonReportSchema } from '@architect/shared';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ARM_ORDER,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  probeLocal,
  runComparison,
  type ComparisonConfig,
  type ComparisonRequest,
} from '../src/comparisons';
import { systemClock } from '../src/loop/deps';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { recorded } from './support/adapter-runtime';
import {
  comparisonWorld,
  HOME_SERVICES,
  RETURNS_DESK,
  type ComparisonWorld,
} from './support/comparison-world';

let world: ComparisonWorld | undefined;

afterAll(async () => {
  await world?.close();
});

describe('a dry run of every arm on fakes', () => {
  it('reports every arm from stored records, a dropped one and a stopped one included', async () => {
    world = comparisonWorld({ clock: systemClock });
    const config: ComparisonConfig = {
      ...DEFAULT_CONFIG,
      arms: [...ARM_ORDER],
      caps: { studentUsd: 15, sparkUsd: 16, computeUsd: 8.1, localMinutes: 1_500 },
      localOllama: true,
      realCompute: true,
      llamaServer: true,
      concurrency: 4,
      studentCaps: { 'weights-targeted': 1 },
    };
    const request: ComparisonRequest = {
      jobDir: RETURNS_DESK,
      regressionJobDir: HOME_SERVICES,
      out: world.out,
      config,
      models: DEFAULT_MODELS,
      confirm: false,
      planOnly: false,
    };

    // The probe times this computer before the plan; then the plan stops for confirmation.
    const probed = await probeLocal(request, world.env, {
      tasks: 3,
      meter: world.env.deps.meter ?? null,
    });
    expect(probed.attempts).toBe(3);
    const asked = await runComparison(request, world.env);
    expect(asked.outcome).toBe('needs_confirmation');

    const { outcome, report } = await runComparison({ ...request, confirm: true }, world.env);
    const out = process.env['ARCHITECT_DRY_RUN_OUT'];
    if (out !== undefined) {
      mkdirSync(out, { recursive: true });
      cpSync(join(world.out, 'report.md'), join(out, 'report.md'));
      cpSync(join(world.out, 'report.json'), join(out, 'report.json'));
      cpSync(join(world.out, 'plan.json'), join(out, 'plan.json'));
    }
    expect(ComparisonReportSchema.parse(report)).toEqual(report);
    expect(outcome).toBe('finished');
    const status = Object.fromEntries(report.arms.map((arm) => [arm.arm, arm.status]));
    expect(status).toEqual({
      bare: 'complete',
      draft: 'complete',
      targeted: 'complete',
      reference: 'complete',
      repeat: 'complete',
      fixed: 'not_run',
      'weights-one-shot': 'complete',
      'weights-targeted': 'stopped',
    });
    expect(existsSync(join(world.out, 'report.md'))).toBe(true);
    expect(readFileSync(join(world.out, 'report.md'), 'utf8')).toContain('Dry run on fakes');
    const arm = (id: string) => report.arms.find((item) => item.arm === id);

    // The dropped arm never started; the stopped one says why and kept to its cap.
    expect(arm('fixed')?.runId).toBeNull();
    expect(arm('fixed')?.reason).toMatch(/^It needs \$\d+\.\d\d of student credit/);
    expect(arm('weights-targeted')?.reason).toMatch(
      /^Stopped when its development had spent \$\d+\.\d\d of the \$\d+\.\d\d its student cap allowed\.$/,
    );
    expect(arm('weights-targeted')?.spent.studentUsd ?? 2).toBeLessThanOrEqual(1);

    // Each backend's table holds only what ran there; pairs never cross tables, but Spark's.
    const tables = Object.fromEntries(report.backends.map((table) => [table.backend, table]));
    expect(Object.keys(tables)).toEqual(['hosted', 'reference', 'local-ollama', 'local-llama.cpp']);
    expect(tables['hosted']?.rows.map((row) => row.arm)).toEqual(['bare', 'draft', 'targeted']);
    expect(tables['reference']?.rows.map((row) => row.arm)).toEqual(['reference']);
    expect(tables['local-ollama']?.rows.map((row) => row.arm)).toEqual([
      'bare',
      'targeted',
      'weights-targeted',
    ]);
    expect(tables['local-llama.cpp']?.rows.map((row) => row.arm)).toEqual(['weights-one-shot']);
    expect(tables['local-llama.cpp']?.rows[0]?.adapterSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(tables['local-ollama']?.rows.every((row) => row.adapterSha256 === null)).toBe(true);
    expect(tables['hosted']?.rows.every((row) => row.peakMemory === null)).toBe(true);
    for (const table of report.backends) {
      const own = new Set(table.rows.map((row) => row.arm));
      for (const pair of table.paired) {
        expect(own.has(pair.a)).toBe(true);
        if (table.backend !== 'reference') expect(own.has(pair.b)).toBe(true);
        else expect(tables['hosted']?.rows.some((row) => row.arm === pair.b)).toBe(true);
      }
    }
    // Repeats are reported apart, each seed on its own, never as more scenarios.
    expect(tables['hosted']?.rows.every((row) => row.scenarios.total === 60)).toBe(true);
    expect(tables['hosted']?.repeats.map((row) => row.seeds.map((seed) => seed.seed))).toEqual([
      [101, 102],
      [101, 102],
      [101, 102],
    ]);

    const store = openEngineStore(new DataPaths(join(world.out, 'data')).database);
    try {
      // Every arm froze before the first locked-test attempt of any arm, by the stored records.
      const runs = store.runs.list().filter((run) => run.protocol?.arm !== undefined);
      const frozenAt = runs.flatMap((run) => (run.freeze === null ? [] : [run.freeze.frozenAt]));
      const firstTest = runs
        .flatMap((run) => store.attempts.list({ runId: run.run.id, split: 'test' }))
        .map((attempt) => attempt.createdAt)
        .sort()[0];
      expect(frozenAt).toHaveLength(5);
      expect(frozenAt.every((at) => firstTest !== undefined && at <= firstTest)).toBe(true);
      expect(runs.some((run) => run.protocol?.arm === 'fixed')).toBe(false);

      // The kept adapter froze with its base's digest, and its package names it.
      const oneShot = arm('weights-one-shot');
      expect(oneShot?.frozen?.adapter?.baseDigest).toBe(world.baseDigest);
      const version = store.versions.forRun(oneShot?.runId ?? '');
      const file = join(world.out, 'data', version?.path ?? '', 'graduate.json');
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        model: { adapter?: { base_digest?: string } };
      };
      // The file names it as `base_digest`; the version's manifest, read back, holds the same.
      expect(raw.model.adapter?.base_digest).toBe(world.baseDigest);
      expect(version?.manifest.model.adapter?.baseDigest).toBe(world.baseDigest);
    } finally {
      store.close();
    }
    expect(recorded(world.llamaRecord).some((entry) => entry.kind === 'chat')).toBe(true);
  }, 300_000);
});
