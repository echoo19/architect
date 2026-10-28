import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED_COMPARISON_ENV, RECORDED_ENV } from './recorded';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const RECORDER = fileURLToPath(
  new URL('../../../examples/gear-returns/scripts/record-run.ts', import.meta.url),
);
const COMPARISON_RECORDER = fileURLToPath(
  new URL('../../../packages/engine/scripts/record-dry-comparison.ts', import.meta.url),
);

function record(script: string, target: string): void {
  execFileSync(process.execPath, ['--import', 'tsx', script, target], {
    cwd: REPO,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/**
 * Records, with the engine's fakes, before any spec runs: one Architect run on the returns desk
 * (scripted models, the real loop, tools, checker and vault), and a comparison of every arm on
 * fakes laid out as the comparisons runner leaves one. The evidence screens then read real
 * records from the app's own engine. Every `pnpm e2e` records them afresh.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const root = await mkdtemp(join(tmpdir(), 'architect-recorded-'));
  const data = join(root, 'data');
  const comparison = join(root, 'comparison');
  record(RECORDER, data);
  record(COMPARISON_RECORDER, comparison);
  process.env[RECORDED_ENV] = data;
  process.env[RECORDED_COMPARISON_ENV] = comparison;
  return async () => {
    await rm(root, { recursive: true, force: true });
  };
}
