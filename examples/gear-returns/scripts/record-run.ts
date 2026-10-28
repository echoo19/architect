/**
 * Records one Architect run on the returns desk into a data folder, with the real engine and
 * scripted models, for the evidence screens and their screenshots. No model is called.
 *
 *   node --import tsx examples/gear-returns/scripts/record-run.ts <dataDir>
 *
 * <dataDir> must be empty or not exist yet. It ends up laid out as the desktop app's own data
 * folder, with recorded-run.json beside architect.db naming the run's records.
 */
import { resolve } from 'node:path';
import { recordRun, SUMMARY_FILE } from '../test/recorded-run';

const USAGE = 'Usage: node --import tsx examples/gear-returns/scripts/record-run.ts <dataDir>';

async function main(): Promise<void> {
  const [target, ...rest] = process.argv.slice(2);
  if (target === undefined || rest.length > 0) throw new Error(USAGE);
  const dataDir = resolve(target);
  const started = performance.now();
  const summary = await recordRun(dataDir);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const rounds = summary.rounds.map((round) => `${round.round} ${round.disposition}`).join(', ');
  process.stdout.write(
    [
      `Recorded run ${summary.runId} of ${summary.jobId} in ${seconds} s.`,
      `Rounds: ${rounds}. Training ended: ${summary.stopReason ?? 'complete'}.`,
      `Locked test ${summary.test.score.pass}/${summary.test.score.total}; Spark on dev ${summary.reference.score?.pass ?? '?'}/${summary.reference.score?.total ?? '?'}.`,
      `Summary: ${resolve(dataDir, SUMMARY_FILE)}`,
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
