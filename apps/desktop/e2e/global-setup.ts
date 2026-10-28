import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECORDED_ENV } from './recorded';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const RECORDER = fileURLToPath(
  new URL('../../../examples/gear-returns/scripts/record-run.ts', import.meta.url),
);

/**
 * Records one Architect run on the returns desk with the engine's fakes (scripted models, the
 * real loop, tools, checker and vault) before any spec runs, so the evidence screens read real
 * records from the app's own engine. Every `pnpm e2e` records it afresh.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const root = await mkdtemp(join(tmpdir(), 'architect-recorded-'));
  const data = join(root, 'data');
  execFileSync(process.execPath, ['--import', 'tsx', RECORDER, data], {
    cwd: REPO,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.env[RECORDED_ENV] = data;
  return async () => {
    await rm(root, { recursive: true, force: true });
  };
}
