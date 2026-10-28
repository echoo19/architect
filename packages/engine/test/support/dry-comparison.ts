import { cpSync, existsSync, readdirSync } from 'node:fs';
import type { ComparisonReport } from '@architect/shared';
import {
  ARM_ORDER,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  probeLocal,
  runComparison,
  type ComparisonConfig,
  type ComparisonRequest,
} from '../../src/comparisons';
import { systemClock } from '../../src/loop/deps';
import { comparisonWorld, HOME_SERVICES, RETURNS_DESK } from './comparison-world';

/**
 * Every arm, with caps that drop the fixed arm for want of student credit and stop the
 * failure-specific adapter at its own cap, so the report has an arm of each kind.
 */
export const DRY_RUN_CONFIG: ComparisonConfig = {
  ...DEFAULT_CONFIG,
  arms: [...ARM_ORDER],
  caps: { studentUsd: 15, sparkUsd: 16, computeUsd: 8.1, localMinutes: 1_500 },
  localOllama: true,
  realCompute: true,
  llamaServer: true,
  concurrency: 4,
  studentCaps: { 'weights-targeted': 1 },
};

/**
 * Runs a comparison of every arm on fakes, as the dry-run test does, and copies the runner's
 * output folder to `out`: its `data` folder, with `report.json` beside it, as the app opens one.
 * Nothing calls a model or trains, and the report says it is a dry run.
 */
export async function recordDryComparison(out: string): Promise<ComparisonReport> {
  if (existsSync(out) && readdirSync(out).length > 0) {
    throw new Error(`${out} isn't empty. Record into a new folder, so it holds only this run.`);
  }
  const world = comparisonWorld({ clock: systemClock });
  try {
    const request: ComparisonRequest = {
      jobDir: RETURNS_DESK,
      regressionJobDir: HOME_SERVICES,
      out: world.out,
      config: DRY_RUN_CONFIG,
      models: DEFAULT_MODELS,
      confirm: true,
      planOnly: false,
    };
    await probeLocal(request, world.env, { tasks: 3, meter: world.env.deps.meter ?? null });
    const { outcome, report } = await runComparison(request, world.env);
    if (outcome !== 'finished') throw new Error(`The dry run ended ${outcome}, not finished.`);
    cpSync(world.out, out, { recursive: true });
    return report;
  } finally {
    await world.close();
  }
}
