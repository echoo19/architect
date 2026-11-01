import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTrainingStore } from '../src/training/store';

const STORE = pathToFileURL(fileURLToPath(new URL('../src/training/store.ts', import.meta.url)));
const HOLD_MS = 1_500;

let dir: string;
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Waits until a file exists, checking every 20 ms, for at most 20 seconds. */
async function until(file: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`${file} never appeared`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

describe("the training records' lock", () => {
  it('holds across processes: one waits while another reserves, and gets it once that ends', async () => {
    dir = mkdtempSync(join(tmpdir(), 'architect-training-lock-'));
    const held = join(dir, 'held');
    const script = join(dir, 'holder.mts');
    writeFileSync(
      script,
      [
        `import { writeFileSync } from 'node:fs';`,
        `import { FileTrainingStore } from ${JSON.stringify(STORE.href)};`,
        `new FileTrainingStore(${JSON.stringify(dir)}).exclusive(() => {`,
        `  writeFileSync(${JSON.stringify(held)}, String(Date.now()));`,
        `  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HOLD_MS});`,
        `});`,
      ].join('\n'),
    );
    const child = spawn(process.execPath, ['--import', 'tsx', script], { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((done) => child.on('exit', done));
    await until(held);

    const asked = Date.now();
    const got = new FileTrainingStore(dir).exclusive(() => Date.now());
    // The other process held it for HOLD_MS from when it wrote the marker; this one waited.
    expect(got - asked).toBeGreaterThan(HOLD_MS / 3);
    expect(await exited, stderr).toBe(0);
  });

  it('is let go of when its holder dies', async () => {
    dir = mkdtempSync(join(tmpdir(), 'architect-training-lock-'));
    const held = join(dir, 'held');
    const script = join(dir, 'dies.mts');
    writeFileSync(
      script,
      [
        `import { writeFileSync } from 'node:fs';`,
        `import { FileTrainingStore } from ${JSON.stringify(STORE.href)};`,
        `new FileTrainingStore(${JSON.stringify(dir)}).exclusive(() => {`,
        `  writeFileSync(${JSON.stringify(held)}, 'held');`,
        `  process.exit(3);`,
        `});`,
      ].join('\n'),
    );
    const child = spawn(process.execPath, ['--import', 'tsx', script], { stdio: 'ignore' });
    expect(await new Promise((done) => child.on('exit', done))).toBe(3);
    expect(existsSync(held)).toBe(true);
    expect(new FileTrainingStore(dir).exclusive(() => 'taken')).toBe('taken');
  });
});
