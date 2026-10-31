import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { COMPARISON_REPORT_FORMAT, ComparisonReportSchema } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARM_ORDER,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  pairedDifference,
  probeLocal,
  reportBeside,
  runComparison,
  type ComparisonConfig,
  type ComparisonRequest,
} from '../src/comparisons';
import { StudentCredit } from '../src/comparisons/spend';
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

const worlds: ComparisonWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

/** Copies a dry run's report and plan where `ARCHITECT_DRY_RUN_OUT` says, under `name`. */
function keep(world: ComparisonWorld, name: string): void {
  const out = process.env['ARCHITECT_DRY_RUN_OUT'];
  if (out === undefined) return;
  mkdirSync(out, { recursive: true });
  cpSync(join(world.out, 'report.md'), join(out, `${name}.md`));
  cpSync(join(world.out, 'report.json'), join(out, `${name}.json`));
  cpSync(join(world.out, 'plan.json'), join(out, `${name}-plan.json`));
}

describe('a dry run of every arm on fakes', () => {
  it('reports every arm from stored records, a dropped one and a stopped one included', async () => {
    const world = comparisonWorld({ clock: systemClock });
    worlds.push(world);
    const config: ComparisonConfig = {
      ...DEFAULT_CONFIG,
      arms: [...ARM_ORDER],
      caps: { studentUsd: 15, sparkUsd: 24, computeUsd: 8.1, localMinutes: 1_500 },
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
    keep(world, 'report');
    expect(ComparisonReportSchema.parse(report)).toEqual(report);
    expect(report.format).toBe(COMPARISON_REPORT_FORMAT);
    // The app opened on the comparison's data folder reads the same report from beside it.
    expect(await reportBeside(join(world.out, 'data'))).toEqual(report);
    expect(await reportBeside(world.out)).toBeNull();
    expect(outcome).toBe('finished');
    const status = Object.fromEntries(report.arms.map((arm) => [arm.arm, arm.status]));
    expect(status).toEqual({
      bare: 'complete',
      draft: 'complete',
      targeted: 'complete',
      reference: 'complete',
      'reference-targeted': 'complete',
      repeat: 'complete',
      fixed: 'not_run',
      'weights-one-shot': 'complete',
      'weights-targeted': 'stopped',
    });
    expect(existsSync(join(world.out, 'report.md'))).toBe(true);
    const markdown = readFileSync(join(world.out, 'report.md'), 'utf8');
    expect(markdown).toContain('Dry run on fakes');
    const arm = (id: string) => report.arms.find((item) => item.arm === id);

    // The dropped arm never started; the stopped one says why and kept to its cap.
    expect(arm('fixed')?.runId).toBeNull();
    expect(arm('fixed')?.reason).toMatch(/^It needs \$\d+\.\d\d of hosted Glimmer's budget/);
    // It kept its adopted harness, then stopped at round 2's start, before paying for it.
    expect(arm('weights-targeted')?.reason).toMatch(
      /^Before round 2 it had spent \$\d+\.\d\d, and one more round with its final test could cost \$\d+\.\d\d more \(at \$\d\.\d{4} an attempt\), past its \$1\.00 cap, so it stopped there with what it had kept\.$/,
    );
    expect(arm('weights-targeted')?.spent.studentUsd ?? 2).toBeLessThanOrEqual(1);

    // Each backend's table holds only what ran there; pairs never cross tables, but Spark's.
    const tables = Object.fromEntries(report.backends.map((table) => [table.backend, table]));
    expect(Object.keys(tables)).toEqual(['hosted', 'reference', 'local-ollama', 'local-llama.cpp']);
    expect(tables['hosted']?.rows.map((row) => row.arm)).toEqual(['bare', 'draft', 'targeted']);
    expect(tables['reference']?.rows.map((row) => row.label)).toEqual([
      'Spark reference, blank harness',
      'Spark reference, targeted harness',
    ]);
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
        else
          expect(own.has(pair.b) || tables['hosted']?.rows.some((row) => row.arm === pair.b)).toBe(
            true,
          );
      }
    }
    expect(tables['reference']?.paired.map((pair) => pair.label)).toContain(
      'Spark reference, targeted harness vs Targeted mentoring',
    );
    // Repeats are reported apart, each seed on its own, never as more scenarios.
    expect(tables['hosted']?.rows.every((row) => row.scenarios.total === 60)).toBe(true);
    expect(tables['hosted']?.repeats.map((row) => row.seeds.map((seed) => seed.seed))).toEqual([
      [101, 102],
      [101, 102],
      [101, 102],
    ]);
    expect(tables['hosted']?.repeats.every((row) => row.complete)).toBe(true);
    // Targets are observed counts: 57 of 60 needed for the 95% target.
    for (const row of tables['hosted']?.rows ?? []) {
      expect(row.passTarget).toEqual({
        passRate: 0.95,
        needed: 57,
        of: 60,
        met: row.scenarios.pass >= 57,
      });
    }
    expect(report.disclosures).toContain(
      "Targets are quoted as observed counts: 57 of 60 meets the job's 95.0% target as observed. That is not proof of 95.0% reliability: 57 of 60 has a 95% Wilson interval of 86.3% to 98.3%.",
    );

    // The money: every dollar once, the draft's development charged to what builds on it.
    const draftSpark = arm('draft')?.spent.sparkUsd ?? 0;
    expect(arm('targeted')?.cumulative?.builtOn).toEqual(['draft']);
    expect(arm('targeted')?.cumulative?.sparkUsd).toBeCloseTo(
      (arm('targeted')?.spent.sparkUsd ?? 0) + draftSpark,
      9,
    );
    expect(arm('weights-one-shot')?.cumulative?.builtOn).toEqual(['targeted', 'draft']);
    expect(report.totals.sparkUsd).toBeCloseTo(
      report.arms.reduce((sum, item) => sum + item.spent.sparkUsd, 0),
      9,
    );
    // The journal and the records agree when nothing was cut off.
    expect(report.credit).toMatchObject({ uncertainRequests: 0, inFlightRequests: 0 });
    expect(report.credit?.settledUsd).toBeCloseTo(report.totals.studentUsd ?? -1, 6);
    expect(report.billing).toMatchObject({ calls: 30, billedCalls: 30, ratio: 1 });
    expect(report.inputs?.job.name).toBe('Returns desk');
    expect(report.inputs?.regression?.name).toBe('Service desk');
    expect(report.plan.releasedAt).not.toBeNull();

    // The second job's sweep is a runtime check, and says what it is not.
    expect(report.regression?.label).toBe('Runtime regression check');
    expect(report.disclosures.join('\n')).toContain(
      'It is not evidence that mentoring caused no regression there',
    );
    // Dev measurements of adapters stay apart from locked results.
    expect(report.adapters.length).toBeGreaterThan(0);
    expect(report.adapters.every((cell) => cell.split === 'dev')).toBe(true);
    expect(markdown).toContain('## Development only: adapter configurations on one llama-server');
    // The adapter that took its locked test trained for real, by its records, and says how.
    expect(arm('weights-one-shot')?.notes.join(' ')).toMatch(
      /ended with its adapter, trained on 12 examples/,
    );
    expect(arm('weights-one-shot')?.notes.join(' ')).toContain('are a pilot recipe');
    expect(report.disclosures.join('\n')).toContain(
      "a result without an effect means this recipe didn't help, not that weights lose to harnesses",
    );
    expect(report.disclosures.join('\n')).toContain('Adapters trained against NF4 weights');
    // An adapter arm ran, so the protocol is printed and no agent is called harness-only. The
    // plan asked for every arm, so none is said to be left out.
    expect(markdown).toContain('Adapter protocol: four-cell.');
    expect(markdown).not.toContain('Every reported agent is harness-only');
    expect(markdown).not.toContain('Not in this comparison');

    // The seeds the plan declared, with the arms that have a result under each: 101 for every arm
    // that took a locked test, and the repeat's 102 for the three it covers.
    expect(report.plan.testSeeds).toEqual([101, 102]);
    expect(report.plan.seedResults).toEqual([
      {
        seed: 101,
        arms: [
          'bare',
          'draft',
          'targeted',
          'reference',
          'reference-targeted',
          'weights-one-shot',
          'weights-targeted',
        ],
      },
      { seed: 102, arms: ['bare', 'draft', 'targeted'] },
    ]);

    // Each pair carries its difference in pass rate, worked out from its own counts.
    const pairs = report.backends.flatMap((table) => table.paired);
    expect(pairs.length).toBeGreaterThan(5);
    for (const item of pairs) {
      expect(item.difference).toEqual(pairedDifference(item));
      expect(item.difference.rate).toBeCloseTo((item.aOnly - item.bOnly) / item.scenarios, 12);
      expect(item.difference.low).toBeLessThanOrEqual(item.difference.rate);
      expect(item.difference.high).toBeGreaterThanOrEqual(item.difference.rate);
    }

    // The rounds an arm used of the most it was allowed, why training ended, and the kept
    // round's own before and after, which are on one scale.
    expect(arm('bare')?.rounds).toBeNull();
    expect(arm('draft')).toMatchObject({ rounds: { used: 1, ended: 'done' }, caps: { rounds: 1 } });
    expect(arm('targeted')?.rounds?.used).toBeLessThanOrEqual(arm('targeted')?.caps.rounds ?? 0);
    expect(arm('targeted')?.rounds?.ended).toEqual(expect.any(String));
    for (const id of ['draft', 'targeted']) {
      const kept = arm(id)
        ?.experiments.filter((item) => item.disposition === 'kept')
        .at(-1);
      expect(kept).toBeDefined();
      expect(arm(id)?.dev.kept).toEqual({
        round: kept?.round,
        kind: kept?.kind,
        before: kept?.devBefore,
        after: kept?.devAfter,
      });
      expect(arm(id)?.dev.kept?.before?.total).toBe(arm(id)?.dev.kept?.after?.total);
    }

    // Where each was measured, and the local build each frozen agent is set to run on.
    expect(arm('bare')?.measuredOn).toEqual(['hosted', 'local-ollama']);
    expect(arm('reference')?.measuredOn).toEqual(['reference']);
    expect(arm('weights-one-shot')?.measuredOn).toEqual(['local-llama.cpp']);
    expect(arm('fixed')?.measuredOn).toEqual([]);
    expect(arm('bare')?.frozen?.localModel).toBe('muse-glimmer:30b-iq2');
    expect(markdown).toContain(
      'Its final test also ran on this computer; see the table "This computer\'s Glimmer on Ollama".',
    );

    // The money: the journal's total is its settled and uncertain charges together, and the
    // student's recorded costs are the sum of their three parts.
    expect(report.credit?.totalUsd).toBeCloseTo(
      (report.credit?.settledUsd ?? NaN) + (report.credit?.uncertainUsd ?? NaN),
      12,
    );
    const parts = report.totals.studentParts;
    expect(parts.armsUsd).toBeCloseTo(
      report.arms.reduce((sum, item) => sum + (item.spent.studentUsd ?? 0), 0),
      9,
    );
    expect(
      (parts.armsUsd ?? NaN) + (parts.calibrationUsd ?? NaN) + (parts.regressionUsd ?? NaN),
    ).toBeCloseTo(report.totals.studentUsd ?? NaN, 9);
    expect(markdown).toContain('settled by the provider');

    // Plain words: no arrow or typographic mark, the loop's stored "30/45 -> 35/45" says "to", and
    // nothing names the folder the dry run was made in.
    const marks = /[\u{2192}\u{2013}\u{2014}\u{2018}\u{2019}\u{201C}\u{201D}\u{2026}]/u;
    expect(markdown).not.toMatch(marks);
    expect(JSON.stringify(report)).not.toMatch(marks);
    expect(arm('draft')?.experiments[0]?.reason).toMatch(/^Dev \d+\/\d+ to \d+\/\d+;/);
    expect(markdown).not.toContain(basename(world.root));
    expect(JSON.stringify(report)).not.toContain(basename(world.root));

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
      expect(report.plan.releasedAt !== null && report.plan.releasedAt <= (firstTest ?? '')).toBe(
        true,
      );
      expect(runs.some((run) => run.protocol?.arm === 'fixed')).toBe(false);
      // The meter's readings of a locked test on this computer are the run's own, to show.
      const readings = store.runtimeMeasurements.list(arm('bare')?.runId ?? '');
      expect(readings.some((item) => item.split === 'test' && item.peakProcessBytes !== null)).toBe(
        true,
      );

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
    // Every hosted request the comparison sent went through the journal, settled.
    const credit = new StudentCredit(join(world.out, 'requests.jsonl'), 15, systemClock);
    expect(credit.total()).toBeLessThanOrEqual(15);
  }, 300_000);

  it('measures a one-shot adapter by the reduced protocol, with and without it', async () => {
    const world = comparisonWorld({ clock: systemClock });
    worlds.push(world);
    const config: ComparisonConfig = {
      ...DEFAULT_CONFIG,
      arms: ['bare', 'draft', 'targeted', 'weights-one-shot'],
      caps: { studentUsd: 15, sparkUsd: 16, computeUsd: 2.7, localMinutes: 1_500 },
      realCompute: true,
      llamaServer: true,
      adapterProtocol: 'reduced',
      concurrency: 4,
    };
    const request: ComparisonRequest = {
      jobDir: RETURNS_DESK,
      out: world.out,
      config,
      models: DEFAULT_MODELS,
      confirm: true,
      planOnly: false,
    };
    const { outcome, report } = await runComparison(request, world.env);
    keep(world, 'report-reduced');
    expect(outcome).toBe('finished');
    expect(report.plan.adapterProtocol).toBe('reduced');
    const markdown = readFileSync(join(world.out, 'report.md'), 'utf8');
    expect(markdown).toContain('Adapter protocol: reduced.');
    const weights = report.arms.find((arm) => arm.arm === 'weights-one-shot');
    expect(weights?.status).toBe('complete');
    // One round: the adapter, checked on train tasks and measured on no dev task.
    expect(weights?.experiments.map((item) => [item.kind, item.disposition])).toEqual([
      ['weights', 'kept'],
    ]);
    expect(weights?.experiments[0]?.reason).toMatch(/^Smoke check on 3 train tasks/);
    expect(report.adapters.map((cell) => [cell.split, cell.label])).toEqual([
      ['train', 'H1/A1 smoke check'],
    ]);
    // Its locked test with and without the adapter, on one llama-server, the same scenarios.
    const llama = report.backends.find((table) => table.backend === 'local-llama.cpp');
    expect(llama?.rows.map((row) => [row.label, row.scenarios.total, row.seed])).toEqual([
      ['One-shot adapter, H1/A1', 60, 101],
      ['One-shot adapter, H1/A0', 60, 101],
    ]);
    expect(llama?.rows[0]?.adapterSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(llama?.rows[1]?.adapterSha256).toBeNull();
    expect(llama?.rows[0]?.harnessHash).toBe(llama?.rows[1]?.harnessHash);
    expect(llama?.paired.map((pair) => [pair.label, pair.scenarios])).toEqual([
      ['One-shot adapter: with its adapter (H1/A1) vs without it (H1/A0), on one llama-server', 60],
    ]);
    // It starts from the targeted arm's frozen harness, and says what it measures.
    expect(weights?.frozen?.harnessHash).toBe(
      report.arms.find((arm) => arm.arm === 'targeted')?.frozen?.harnessHash,
    );
    expect(weights?.notes.join(' ')).toContain(
      "It measures only this adapter's added effect given the frozen targeted harness",
    );
    // Both configurations ran on the stand-in llama-server, with the adapter applied and not.
    const chats = recorded(world.llamaRecord).filter((entry) => entry.kind === 'chat');
    expect(chats.length).toBeGreaterThan(120);
  }, 300_000);
});
