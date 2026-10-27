import type { EnginePort } from '@architect/engine';
import type { RunEvent } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EngineSupervisor,
  type EngineProcess,
  type EngineSupervisorOptions,
} from '../../../src/main/engine/supervisor';
import { askForSecrets, type EngineStatus } from '../../../src/utility/link';
import { channel } from './channel';

/** An engine process that answers `jobs.list` with no jobs, unless told to hold its answers. */
class FakeEngine implements EngineProcess {
  readonly requests: EnginePort;
  readonly secrets: EnginePort;
  /** The engine's own end of the secrets channel. */
  readonly secretLookup: (ref: string) => Promise<string | undefined>;
  hold = false;
  stopsCleanly = true;
  stopRequested = false;
  killed = false;
  private readonly engineSide: EnginePort;
  private readonly statusListeners: ((status: EngineStatus) => void)[] = [];
  private readonly exitListeners: ((code: number) => void)[] = [];
  private exited = false;

  constructor() {
    const [requests, engineSide] = channel();
    const [secrets, secretSide] = channel();
    this.requests = requests;
    this.secrets = secrets;
    this.engineSide = engineSide;
    this.secretLookup = askForSecrets(secretSide);
    engineSide.onMessage((message) => {
      const { id } = message as { id: number };
      if (!this.hold) engineSide.postMessage({ kind: 'response', id, ok: true, result: [] });
    });
  }

  emit(event: RunEvent): void {
    this.engineSide.postMessage({ kind: 'event', event });
  }

  report(status: EngineStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }

  exit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.exitListeners.forEach((listener) => listener(code));
  }

  onStatus(listener: (status: EngineStatus) => void): void {
    this.statusListeners.push(listener);
  }

  onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener);
  }

  requestStop(): void {
    this.stopRequested = true;
    if (this.stopsCleanly) this.exit(0);
  }

  kill(): void {
    this.killed = true;
    this.exit(1);
  }
}

function setup(options: Partial<EngineSupervisorOptions> = {}) {
  const launched: FakeEngine[] = [];
  const events: RunEvent[] = [];
  const supervisor = new EngineSupervisor({
    launch: () => {
      const engine = new FakeEngine();
      launched.push(engine);
      return engine;
    },
    getSecret: async (ref) => (ref === 'meta' ? 'sk-meta' : undefined),
    onEvent: (event) => events.push(event),
    restartDelaysMs: [20, 40],
    stopTimeoutMs: 50,
    ...options,
  });
  supervisor.start();
  const engine = (index: number): FakeEngine => {
    const found = launched[index];
    if (!found) throw new Error(`No engine process ${index} was launched.`);
    return found;
  };
  const listJobs = () => supervisor.call((api) => api.jobs.list());
  return { supervisor, launched, events, engine, listJobs };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errors.mockRestore();
});

describe('EngineSupervisor', () => {
  it('forwards requests to the engine and its run events to the app', async () => {
    const { engine, events, listJobs } = setup();
    await expect(listJobs()).resolves.toEqual([]);

    const event: RunEvent = {
      type: 'log',
      runId: 'run_1',
      at: '2026-10-27T12:00:00.000Z',
      level: 'info',
      message: 'Round 1 started.',
    };
    engine(0).emit(event);
    await vi.waitFor(() => expect(events).toEqual([event]));
  });

  it("answers the engine's secret lookups from main", async () => {
    const { engine } = setup();
    await expect(engine(0).secretLookup('meta')).resolves.toBe('sk-meta');
    await expect(engine(0).secretLookup('together')).resolves.toBeUndefined();
  });

  it('fails calls at once while the engine is down, then restarts it', async () => {
    const { engine, launched, listJobs } = setup();
    engine(0).exit(1);
    await expect(listJobs()).rejects.toThrow(
      'The engine stopped unexpectedly and is restarting. Try again in a moment.',
    );
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    await expect(listJobs()).resolves.toEqual([]);
    expect(errors).toHaveBeenCalledWith(
      '[engine] The engine process exited unexpectedly (code 1).',
    );
  });

  it('fails a request the engine was answering when it exited', async () => {
    const { engine, listJobs } = setup();
    engine(0).hold = true;
    const pending = listJobs();
    await sleep(5);
    engine(0).exit(1);
    await expect(pending).rejects.toThrow('The engine stopped while it was working on this.');
  });

  it('waits longer after each failure in a row', async () => {
    const { engine, launched } = setup({ restartDelaysMs: [10, 200] });
    engine(0).exit(1);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    const crashed = Date.now();
    engine(1).exit(1);
    await sleep(100);
    expect(launched).toHaveLength(2);
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    expect(Date.now() - crashed).toBeGreaterThanOrEqual(190);
  });

  it('starts the waits over once the engine has run for a while', async () => {
    const { engine, launched } = setup({ restartDelaysMs: [10, 5_000], stableAfterMs: 0 });
    engine(0).exit(1);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    engine(1).exit(1);
    await vi.waitFor(() => expect(launched).toHaveLength(3), { timeout: 1_000 });
  });

  it('says why the engine could not start, and keeps trying', async () => {
    const { engine, launched, listJobs } = setup();
    engine(0).report({ type: 'failed', message: 'The database is locked.' });
    expect(engine(0).killed).toBe(true);
    await expect(listJobs()).rejects.toThrow(
      "The engine couldn't start: The database is locked. Architect keeps trying in the background.",
    );
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    engine(1).report({ type: 'ready' });
    await expect(listJobs()).resolves.toEqual([]);
  });

  it('keeps trying when the process cannot be launched', async () => {
    let attempts = 0;
    const { listJobs } = setup({
      launch: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('The utility process could not be created.');
        return new FakeEngine();
      },
    });
    await expect(listJobs()).rejects.toThrow(
      "The engine couldn't start: The utility process could not be created.",
    );
    await vi.waitFor(() => expect(attempts).toBe(2));
    await expect(listJobs()).resolves.toEqual([]);
  });

  it('stops the engine cleanly and never restarts it afterwards', async () => {
    const { supervisor, engine, launched, listJobs } = setup();
    await supervisor.stop();
    expect(engine(0).stopRequested).toBe(true);
    expect(engine(0).killed).toBe(false);
    await expect(listJobs()).rejects.toThrow(
      'The engine has stopped because Architect is closing.',
    );
    await sleep(60);
    expect(launched).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it('cancels a pending restart when it stops', async () => {
    const { supervisor, engine, launched } = setup({ restartDelaysMs: [30] });
    engine(0).exit(1);
    await supervisor.stop();
    await sleep(60);
    expect(launched).toHaveLength(1);
  });

  it('kills an engine that does not stop in time', async () => {
    const { supervisor, engine } = setup({ stopTimeoutMs: 20 });
    engine(0).stopsCleanly = false;
    await supervisor.stop();
    expect(engine(0).stopRequested).toBe(true);
    expect(engine(0).killed).toBe(true);
  });
});
