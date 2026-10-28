import { randomBytes } from 'node:crypto';
import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { emptyLease, LeaseStateSchema, type LeaseState } from './lease-rules';
import { isAlive } from './pids';

/*
 * The GPU lease's files, in the app's data folder: `local-runtime/gpu-lease.json` holds who has
 * the GPU and who waits, and `local-runtime/gpu-lease.lock` is held while one process changes it.
 * Every change is one synchronous read, change and write under the lock, so no two processes
 * interleave and the lock is held for well under a second. Plain files, so the lease works the
 * same in Node and in Electron's utility processes, with no native module.
 */

const LockSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string(),
  at: z.number(),
});

/** Errors Windows gives for a moment while another process creates, replaces or deletes a file. */
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** Waits without leaving the current turn: the critical section stays one synchronous step. */
function pause(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // A thread that may not block waits by watching the clock instead; these waits are a few ms.
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // Waiting.
    }
  }
}

export interface LeaseStoreOptions {
  /** `local-runtime` in the app's data folder. */
  dir: string;
  /**
   * A lock older than this was left by a process that stopped mid-change: a change takes a few
   * milliseconds. Default 5 s.
   */
  lockStaleMs?: number;
}

export class LeaseStore {
  readonly stateFile: string;
  private readonly lockFile: string;
  private readonly lockStaleMs: number;

  constructor(private readonly options: LeaseStoreOptions) {
    this.stateFile = join(options.dir, 'gpu-lease.json');
    this.lockFile = join(options.dir, 'gpu-lease.lock');
    this.lockStaleMs = options.lockStaleMs ?? 5_000;
  }

  /**
   * The lease as it stands, read without the lock: whole, since every write replaces the file in
   * one rename. A file that can't be read for a moment, or doesn't exist yet, reads as empty.
   */
  peek(): LeaseState {
    for (let attempt = 0; ; attempt++) {
      try {
        return this.parse(readFileSync(this.stateFile, 'utf8'));
      } catch (error) {
        const code = codeOf(error);
        if (code === 'ENOENT') return emptyLease();
        if (!TRANSIENT.has(code ?? '') || attempt >= 20) throw error;
        pause(5);
      }
    }
  }

  /**
   * Runs `change` on the lease under the lock and writes back what it leaves, when it says it
   * changed something. `change` must be synchronous: nothing else may run while the lock is held.
   */
  async update<T>(change: (state: LeaseState) => { result: T; write: boolean }): Promise<T> {
    const token = await this.lock();
    try {
      const state = this.peek();
      const { result, write } = change(state);
      if (write) this.write(state);
      return result;
    } finally {
      this.unlock(token);
    }
  }

  /** The same as `update`, all in one step, for a process that is exiting. */
  updateNow(change: (state: LeaseState) => boolean): void {
    const deadline = Date.now() + 1_000;
    let token = this.tryLock();
    while (token === null && Date.now() < deadline) {
      this.breakIfStale();
      pause(5);
      token = this.tryLock();
    }
    if (token === null) return;
    try {
      const state = this.peek();
      if (change(state)) this.write(state);
    } finally {
      this.unlock(token);
    }
  }

  private parse(text: string): LeaseState {
    if (text.trim() === '') return emptyLease();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return emptyLease();
    }
    const parsed = LeaseStateSchema.safeParse(raw);
    // A file this build can't read is started afresh: its holders say so again on their next beat.
    return parsed.success ? parsed.data : emptyLease();
  }

  private write(state: LeaseState): void {
    const temp = `${this.stateFile}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(temp, JSON.stringify(state));
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(temp, this.stateFile);
        return;
      } catch (error) {
        if (!TRANSIENT.has(codeOf(error) ?? '') || attempt >= 40) {
          rmSync(temp, { force: true });
          throw error;
        }
        pause(5);
      }
    }
  }

  private async lock(): Promise<string> {
    for (;;) {
      const token = this.tryLock();
      if (token !== null) return token;
      this.breakIfStale();
      await new Promise((done) => setTimeout(done, 2 + Math.floor(Math.random() * 6)));
    }
  }

  /** Creates the lock, or null when another process holds it. */
  private tryLock(): string | null {
    const token = randomBytes(8).toString('hex');
    let fd: number;
    try {
      fd = openSync(this.lockFile, 'wx');
    } catch (error) {
      const code = codeOf(error);
      if (code === 'ENOENT') {
        mkdirSync(this.options.dir, { recursive: true });
        return null;
      }
      if (code === 'EEXIST' || TRANSIENT.has(code ?? '')) return null;
      throw error;
    }
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, token, at: Date.now() }));
    } finally {
      closeSync(fd);
    }
    return token;
  }

  private unlock(token: string): void {
    try {
      const held = LockSchema.safeParse(JSON.parse(readFileSync(this.lockFile, 'utf8')));
      // Only this process's own lock: one taken as stale meanwhile belongs to someone else now.
      if (held.success && held.data.token === token) rmSync(this.lockFile, { force: true });
    } catch {
      // Gone already.
    }
  }

  /**
   * Takes away a lock whose process died while holding it, or that has been held far longer than
   * a change takes. It is moved aside before it is deleted, so two processes that both found it
   * stale can't delete a lock one of them has just taken: what was moved is checked, and a lock
   * taken since is put back.
   */
  private breakIfStale(): void {
    let text: string;
    let identity: bigint;
    let modified: number;
    try {
      const stats = statSync(this.lockFile, { bigint: true });
      identity = stats.ino;
      modified = Number(stats.mtimeMs);
      text = readFileSync(this.lockFile, 'utf8');
    } catch {
      return;
    }
    const held = (() => {
      try {
        return LockSchema.safeParse(JSON.parse(text));
      } catch {
        return null;
      }
    })();
    const now = Date.now();
    const stale = held?.success
      ? !isAlive(held.data.pid) || now - held.data.at > this.lockStaleMs
      : now - modified > this.lockStaleMs;
    if (!stale) return;
    const aside = `${this.lockFile}.${randomBytes(6).toString('hex')}.stale`;
    try {
      renameSync(this.lockFile, aside);
    } catch {
      return;
    }
    try {
      const moved = statSync(aside, { bigint: true });
      const same =
        readFileSync(aside, 'utf8') === text && (identity === 0n || moved.ino === identity);
      if (!same) linkSync(aside, this.lockFile);
    } catch {
      // A newer lock is in its place: the one moved aside has no claim left.
    } finally {
      rmSync(aside, { force: true });
    }
  }
}
