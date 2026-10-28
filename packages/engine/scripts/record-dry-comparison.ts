/**
 * Records a comparison of every arm on fakes into a folder laid out as the comparisons runner
 * leaves one: its `data` folder, and `report.json` beside it, for the app's e2e specs and
 * screenshots to open (decision 049). No model is called and nothing is trained.
 *
 *   node --import tsx packages/engine/scripts/record-dry-comparison.ts <out>
 *
 * <out> must be empty or not exist yet.
 */
import { resolve } from 'node:path';
import { recordDryComparison } from '../test/support/dry-comparison';

const USAGE = 'Usage: node --import tsx packages/engine/scripts/record-dry-comparison.ts <out>';

async function main(): Promise<void> {
  const [target, ...rest] = process.argv.slice(2);
  if (target === undefined || rest.length > 0) throw new Error(USAGE);
  const out = resolve(target);
  const started = performance.now();
  const report = await recordDryComparison(out);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const arms = report.arms.map((arm) => `${arm.arm} ${arm.status}`).join(', ');
  process.stdout.write(`Recorded a dry-run comparison in ${seconds} s: ${arms}.\n${out}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
