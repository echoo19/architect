import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { AdapterError } from '@architect/shared';
import { LocalRuntimeError } from './errors';
import {
  asksAhead,
  blockingHolders,
  emptyLease,
  GPU_USES,
  mayJoinBusy,
  mayTake,
  rankOf,
  ranksAhead,
  shouldYield,
  type GpuPurpose,
  type GpuUse,
  type LeaseAsk,
  type LeaseHolder,
  type LeaseState,
  type Place,
} from './lease-rules';
import { LeaseStore } from './lease-store';
import { OllamaUse } from './ollama-use';
import { isAlive } from './pids';
import { stopServerLeftIn } from './server';

export interface GpuLeaseOptions {
  /** The app's data folder: every Architect process on it shares one lease. */
  dataDir: string;
  /** Which process this is (`workspace`, `engine` or `cli`): a busy error names it. */
  owner: string;
  /** How long a request waits its turn before it fails as busy. Default 5 minutes. */
  waitMs?: number;
  /** How often a process holding or waiting for the GPU looks at the lease. Default 250 ms. */
  pollMs?: number;
  /** How often a process holding or waiting says it is still there. Default 5 s. */
  heartbeatMs?: number;
  /**
   * An entry not renewed for this long belongs to a process that is gone, even if another
   * process has since been given its id. One whose process has exited is gone at once. Default 60 s.
   */
  staleMs?: number;
  /** How long Ollama keeps a model loaded after its last request: its own default, 5 minutes. */
  ollamaKeepAliveMs?: number;
  /** Problems nobody is waiting on, such as a server that wouldn't stop when asked to. */
  onError?(error: unknown): void;
}

/** How this process gives up one use of the GPU, and whether that use still has a model loaded. */
export interface GpuRelease {
  /** Frees the GPU: stops the llama-server, or unloads the Ollama models this process used. */
  release(): Promise<void>;
  /** Whether a model is still loaded; once none is, the process lets go without a release. */
  resident(): boolean;
  /** The llama-server's folder, so a process that takes over after this one dies can stop it. */
  serverDir?: string;
}

/** One request's, or one reply's, hold of the GPU. */
export interface GpuHold {
  release(): void;
}

/** How Architect's processes are named to someone kept waiting. */
const OWNER_NAMES: Readonly<Record<string, string>> = {
  workspace: 'the workspace',
  engine: 'Architect',
  cli: 'the architect command',
  script: 'a developer script',
};

const nameOf = (owner: string) => OWNER_NAMES[owner] ?? owner;

interface Slot {
  registration: GpuRelease | null;
  /** This process has the GPU for this use: its entry is in the lease. */
  holding: boolean;
  /** It is giving the GPU up now: nothing joins until that is done. */
  leaving: boolean;
  /** Holds running now. */
  active: Set<{ purpose: GpuPurpose }>;
  /** What it last did, which its entry says while nothing runs. */
  last: GpuPurpose | null;
}

interface Waiter {
  use: GpuUse;
  purpose: GpuPurpose;
  place: Place;
  deadline: number;
  resolve(hold: GpuHold): void;
  reject(error: unknown): void;
}

interface Step {
  granted: [Waiter, GpuHold][];
  expired: [Waiter, LocalRuntimeError][];
  leaving: GpuUse[];
}

/** Leases still open in this process, so an exit takes their entries away with it. */
const open = new Set<GpuLease>();
let exitHooked = false;

function track(lease: GpuLease): void {
  open.add(lease);
  if (exitHooked) return;
  exitHooked = true;
  process.on('exit', () => {
    for (const each of open) each.leaveNow();
  });
}

const aborted = () => new AdapterError('aborted', 'Waiting for the GPU was stopped.');

function joinWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

/**
 * This process's part in the machine-wide GPU lease (decision 046): every Architect process on
 * one data folder takes it before a model loads on the GPU and holds it while a request runs. A
 * llama-server holds the GPU alone; Ollama's users share it. A holder with nothing running gives
 * the GPU up when someone else asks; a busy one keeps it, and the one asking waits its turn, up
 * to `waitMs`, then fails with an error that says who holds it and what to do. A reply goes
 * before a check, and a check before a run's next request. A holder that died stops blocking at
 * once, and the next process to take over stops the llama-server it left behind.
 */
export class GpuLease {
  /** Ollama on this computer, as this process uses it under the lease. */
  readonly ollama: OllamaUse;
  private readonly store: LeaseStore;
  private readonly token = randomBytes(6).toString('hex');
  private readonly slots: Record<GpuUse, Slot>;
  private readonly waiters = new Set<Waiter>();
  /** Holders that died, whose llama-server has been looked for and stopped. */
  private readonly reaped = new Set<string>();
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private view: LeaseState = emptyLease();
  private ticking: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private lastWrite = 0;
  private lastTick = 0;
  private graceUntil = 0;
  /** This process has written to the lease, so it may have entries to take away. */
  private entered = false;
  private closed = false;

  constructor(private readonly options: GpuLeaseOptions) {
    this.store = new LeaseStore({ dir: join(options.dataDir, 'local-runtime') });
    this.waitMs = options.waitMs ?? 5 * 60_000;
    this.pollMs = options.pollMs ?? 250;
    this.heartbeatMs = options.heartbeatMs ?? 5_000;
    this.staleMs = options.staleMs ?? 60_000;
    const slot = (): Slot => ({
      registration: null,
      holding: false,
      leaving: false,
      active: new Set(),
      last: null,
    });
    this.slots = { 'llama-server': slot(), ollama: slot() };
    this.ollama = new OllamaUse(this, {
      keepAliveMs: options.ollamaKeepAliveMs ?? 5 * 60_000,
    });
    track(this);
  }

  /**
   * Says how this process gives up `use` when it must, and whether a model is still loaded. A use
   * nothing serves has nothing to free: it lets go as soon as nothing runs on it.
   */
  serve(use: GpuUse, registration: GpuRelease): void {
    this.slots[use].registration = registration;
  }

  /**
   * Holds the GPU for `use` for one request, or one reply: at once when this process has it and
   * nobody who goes first is waiting, otherwise in its turn. Fails with a busy error after
   * `waitMs`, and as aborted when `signal` aborts first.
   */
  hold(use: GpuUse, purpose: GpuPurpose, signal?: AbortSignal): Promise<GpuHold> {
    if (this.closed) return Promise.reject(aborted());
    if (signal?.aborted) return Promise.reject(aborted());
    const slot = this.slots[use];
    const place: Place = {
      user: this.user(use),
      rank: rankOf(purpose.priority),
      since: Date.now(),
    };
    if (slot.holding && !slot.leaving && this.mayJoin(use, place, this.freshView())) {
      const hold = this.grant(use, purpose);
      this.kick();
      return Promise.resolve(hold);
    }
    return new Promise<GpuHold>((resolve, reject) => {
      const onAbort = () => {
        if (!this.waiters.delete(waiter)) return;
        reject(aborted());
        this.kick();
      };
      const waiter: Waiter = {
        use,
        purpose,
        place,
        deadline: place.since + this.waitMs,
        resolve: (hold) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(hold);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.add(waiter);
      this.kick();
    });
  }

  /** Leaves the lease: waiting requests fail as stopped, and this process's entries go. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    open.delete(this);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const waiter of this.waiters) waiter.reject(aborted());
    this.waiters.clear();
    await this.ticking;
    for (const use of GPU_USES) {
      this.slots[use].holding = false;
      this.slots[use].leaving = false;
    }
    if (!this.entered) return;
    try {
      await this.store.update((state) => ({ result: undefined, write: this.removeOwn(state) }));
    } catch (error) {
      this.report(error);
    }
  }

  /** Takes this process's entries away at once, as it exits. */
  leaveNow(): void {
    if (!this.entered) return;
    try {
      this.store.updateNow((state) => this.removeOwn(state));
    } catch {
      // The process is exiting: whoever comes next finds its entries stale.
    }
  }

  private user(use: GpuUse): string {
    return `${this.token}:${use}`;
  }

  private report(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else console.error('[gpu]', error);
  }

  /** Whether an entry's process is still there and still saying so. */
  private isLive(entry: { pid: number; beat: number }, now: number): boolean {
    if (!isAlive(entry.pid)) return false;
    return now < this.graceUntil || now - entry.beat <= this.staleMs;
  }

  /** The lease without entries of processes that are gone. */
  private live(state: LeaseState, now = Date.now()): LeaseState {
    return {
      holders: state.holders.filter((holder) => this.isLive(holder, now)),
      asks: state.asks.filter((ask) => this.isLive(ask, now)),
    };
  }

  private freshView(): LeaseState {
    try {
      return this.live(this.store.peek());
    } catch {
      return this.live(this.view);
    }
  }

  /** Whether one more request may join this process's hold of `use`. */
  private mayJoin(use: GpuUse, place: Place, state: LeaseState): boolean {
    return this.slots[use].active.size > 0
      ? mayJoinBusy(state, place.user, use, place.rank)
      : mayTake(state, use, place);
  }

  private grant(use: GpuUse, purpose: GpuPurpose): GpuHold {
    const slot = this.slots[use];
    const entry = { purpose };
    slot.active.add(entry);
    slot.holding = true;
    slot.last = purpose;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        slot.active.delete(entry);
        this.kick();
      },
    };
  }

  private kick(): void {
    if (this.closed) return;
    if (this.ticking) {
      this.again = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ticking = this.tick()
      .catch((error: unknown) => this.report(error))
      .finally(() => {
        this.ticking = null;
        if (this.again) {
          this.again = false;
          this.kick();
        } else {
          this.schedule();
        }
      });
  }

  /**
   * Looks again soon while anything is held or waited for. Only waiting keeps the process alive:
   * a process that holds the GPU with nothing to do may exit, and its entry goes with it.
   */
  private schedule(): void {
    if (this.closed) return;
    const waiting = this.waiters.size > 0;
    const holding = GPU_USES.some((use) => this.slots[use].holding);
    if (!waiting && !holding) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, this.pollMs);
    if (!waiting) this.timer.unref();
  }

  private async tick(): Promise<void> {
    const started = Date.now();
    // After the computer slept, every process's beat is old at once: give them time to beat again.
    if (this.lastTick !== 0 && started - this.lastTick > this.staleMs) {
      this.graceUntil = started + this.staleMs;
    }
    this.lastTick = started;
    // What was decided under the lock stands even if writing it failed: the next look writes it.
    const decided: { step?: Step } = {};
    try {
      await this.reapGone(this.store.peek());
      await this.store.update((state) => {
        const { result, write } = this.step(state);
        decided.step = result;
        return { result: undefined, write };
      });
    } catch (error) {
      this.report(error);
      this.expireOnFailure(error);
    }
    const step = decided.step;
    if (step === undefined) return;
    for (const [waiter, hold] of step.granted) waiter.resolve(hold);
    for (const [waiter, error] of step.expired) waiter.reject(error);
    for (const use of step.leaving) void this.giveUp(use);
  }

  /** Stops the llama-servers that holders who died left running, before anyone takes their place. */
  private async reapGone(state: LeaseState): Promise<void> {
    const now = Date.now();
    for (const holder of state.holders) {
      if (holder.use !== 'llama-server' || holder.serverDir === undefined) continue;
      if (this.reaped.has(holder.user) || this.isLive(holder, now)) continue;
      try {
        await stopServerLeftIn(holder.serverDir);
      } catch (error) {
        this.report(error);
      }
      this.reaped.add(holder.user);
    }
  }

  /** One look at the lease under its lock: who goes, who gives up, who waited too long. */
  private step(state: LeaseState): { result: Step; write: boolean } {
    const now = Date.now();
    let write = this.prune(state, now);
    const result: Step = { granted: [], expired: [], leaving: [] };
    write = this.syncAsks(state) || write;
    const ordered = [...this.waiters].sort((a, b) => (ranksAhead(a.place, b.place) ? -1 : 1));
    for (const waiter of ordered) {
      const slot = this.slots[waiter.use];
      if (slot.leaving) continue;
      const allowed = slot.holding
        ? this.mayJoin(waiter.use, waiter.place, state)
        : mayTake(state, waiter.use, waiter.place);
      if (!allowed) continue;
      this.waiters.delete(waiter);
      result.granted.push([waiter, this.grant(waiter.use, waiter.purpose)]);
      // Written at once, so this process's other use sees it holds the GPU now.
      this.syncHolders(state);
      this.syncAsks(state);
      write = true;
    }
    for (const waiter of this.waiters) {
      if (now < waiter.deadline) continue;
      this.waiters.delete(waiter);
      result.expired.push([waiter, this.busyError(state, waiter)]);
      write = true;
    }
    for (const use of GPU_USES) {
      const slot = this.slots[use];
      if (!slot.holding || slot.leaving || slot.active.size > 0) continue;
      if (shouldYield(state, { user: this.user(use), use }, this.placeOf(use))) {
        slot.leaving = true;
        result.leaving.push(use);
      } else if (!(slot.registration?.resident() ?? false)) {
        slot.holding = false;
      }
    }
    write = this.syncAsks(state) || write;
    write = this.syncHolders(state) || write;
    if (write || now - this.lastWrite >= this.heartbeatMs) {
      for (const entry of [...state.holders, ...state.asks]) {
        if (entry.user.startsWith(`${this.token}:`)) entry.beat = now;
      }
      this.lastWrite = now;
      this.entered = true;
      write = true;
    }
    this.view = state;
    return { result, write };
  }

  /**
   * Takes out the entries of processes that are gone. A llama-server holder stays until its server
   * has been looked for and stopped, which happens outside the lock.
   */
  private prune(state: LeaseState, now: number): boolean {
    const before = state.holders.length + state.asks.length;
    state.holders = state.holders.filter(
      (holder) =>
        this.isLive(holder, now) ||
        (holder.use === 'llama-server' &&
          holder.serverDir !== undefined &&
          !this.reaped.has(holder.user)),
    );
    state.asks = state.asks.filter((ask) => this.isLive(ask, now));
    return state.holders.length + state.asks.length !== before;
  }

  /** The place in line of this process's first request waiting for `use`, if one waits. */
  private placeOf(use: GpuUse): Place | null {
    let first: Place | null = null;
    for (const waiter of this.waiters) {
      if (waiter.use !== use) continue;
      if (first === null || ranksAhead(waiter.place, first)) first = waiter.place;
    }
    return first;
  }

  /** Makes this process's asks say what waits now. True when that changed them. */
  private syncAsks(state: LeaseState): boolean {
    let changed = false;
    for (const use of GPU_USES) {
      const user = this.user(use);
      const index = state.asks.findIndex((ask) => ask.user === user);
      const place = this.placeOf(use);
      if (place === null) {
        if (index !== -1) {
          state.asks.splice(index, 1);
          changed = true;
        }
        continue;
      }
      const first = [...this.waiters].find(
        (waiter) => waiter.use === use && waiter.place === place,
      );
      const existing = index === -1 ? undefined : state.asks[index];
      const ask: LeaseAsk = {
        user,
        pid: process.pid,
        owner: this.options.owner,
        use,
        beat: existing?.beat ?? Date.now(),
        rank: place.rank,
        since: place.since,
        doing: first?.purpose.doing ?? '',
      };
      if (existing && sameEntry(existing, ask)) continue;
      if (index === -1) state.asks.push(ask);
      else state.asks[index] = ask;
      changed = true;
    }
    return changed;
  }

  /** Makes this process's holder entries say what it holds now. True when that changed them. */
  private syncHolders(state: LeaseState): boolean {
    let changed = false;
    for (const use of GPU_USES) {
      const slot = this.slots[use];
      const user = this.user(use);
      const index = state.holders.findIndex((holder) => holder.user === user);
      if (!slot.holding) {
        if (index !== -1) {
          state.holders.splice(index, 1);
          changed = true;
        }
        continue;
      }
      const purpose = topPurpose(slot) ?? slot.last;
      const existing = index === -1 ? undefined : state.holders[index];
      const serverDir = slot.registration?.serverDir;
      const holder: LeaseHolder = {
        user,
        pid: process.pid,
        owner: this.options.owner,
        use,
        beat: existing?.beat ?? Date.now(),
        busy: slot.active.size > 0,
        leaving: slot.leaving,
        doing: purpose?.doing ?? '',
        hint: purpose?.hint ?? '',
        ...(serverDir === undefined ? {} : { serverDir }),
      };
      if (existing && sameEntry(existing, holder)) continue;
      if (index === -1) state.holders.push(holder);
      else state.holders[index] = holder;
      changed = true;
    }
    return changed;
  }

  private removeOwn(state: LeaseState): boolean {
    const own = (entry: { user: string }) => entry.user.startsWith(`${this.token}:`);
    const before = state.holders.length + state.asks.length;
    state.holders = state.holders.filter((holder) => !own(holder));
    state.asks = state.asks.filter((ask) => !own(ask));
    return state.holders.length + state.asks.length !== before;
  }

  /** Gives the GPU up for `use`: frees it first, then takes this process's entry away. */
  private async giveUp(use: GpuUse): Promise<void> {
    const slot = this.slots[use];
    try {
      await slot.registration?.release();
    } catch (error) {
      this.report(error);
    }
    slot.holding = false;
    slot.leaving = false;
    if (this.closed) return;
    try {
      await this.store.update((state) => ({ result: undefined, write: this.syncHolders(state) }));
    } catch (error) {
      this.report(error);
    }
    this.kick();
  }

  /** Why a request waited in vain: who holds the GPU and what they are doing, or who is ahead. */
  private busyError(state: LeaseState, waiter: Waiter): LocalRuntimeError {
    const live = this.live(state);
    const holders = blockingHolders(live, waiter.place.user, waiter.use);
    const parts = holders.map(
      (holder) =>
        `${nameOf(holder.owner)} is ${holder.busy && !holder.leaving ? holder.doing : 'letting go of it'}`,
    );
    const working = holders.find((holder) => holder.busy && !holder.leaving);
    if (parts.length === 0) {
      for (const ask of asksAhead(live, waiter.use, waiter.place)) {
        parts.push(`${nameOf(ask.owner)} is waiting for it first`);
      }
    }
    const message =
      parts.length === 0 ? 'The GPU is busy.' : `The GPU is busy: ${joinWithAnd(parts)}.`;
    return new LocalRuntimeError('gpu_busy', message, working?.hint ?? 'Try again in a moment.');
  }

  /** When the lease itself can't be read or written, waiting requests past their time fail with why. */
  private expireOnFailure(error: unknown): void {
    const now = Date.now();
    for (const waiter of this.waiters) {
      if (now < waiter.deadline) continue;
      this.waiters.delete(waiter);
      waiter.reject(
        new LocalRuntimeError(
          'gpu_busy',
          `Architect couldn't read who is using the GPU: ${error instanceof Error ? error.message : String(error)}`,
          "Check that Architect's data folder can be written to, then try again.",
        ),
      );
    }
  }
}

/** The purpose of the most important hold running in a slot. */
function topPurpose(slot: Slot): GpuPurpose | null {
  let top: GpuPurpose | null = null;
  for (const { purpose } of slot.active) {
    if (top === null || rankOf(purpose.priority) > rankOf(top.priority)) top = purpose;
  }
  return top;
}

/** Two entries that say the same, whenever each was last renewed. */
function sameEntry<T extends { beat: number }>(a: T, b: T): boolean {
  return JSON.stringify({ ...a, beat: 0 }) === JSON.stringify({ ...b, beat: 0 });
}
