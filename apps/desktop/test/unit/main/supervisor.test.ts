import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Supervisor,
  type ProcessStatus,
  type SupervisedProcess,
  type SupervisorOptions,
} from '../../../src/main/processes/supervisor';

/** A connection that answers `ping`, or holds its answers until it is closed. */
class FakeClient {
  hold = false;
  closed = false;
  private readonly waiting: ((error: Error) => void)[] = [];

  async ping(): Promise<string> {
    if (!this.hold) return 'pong';
    return new Promise((_resolve, reject) => this.waiting.push(reject));
  }

  close(): void {
    this.closed = true;
    for (const reject of this.waiting.splice(0)) reject(new Error('The connection closed.'));
  }
}

class FakeProcess implements SupervisedProcess<FakeClient> {
  readonly client = new FakeClient();
  stopsCleanly = true;
  stopRequested = false;
  killed = false;
  private readonly statusListeners: ((status: ProcessStatus) => void)[] = [];
  private readonly exitListeners: ((code: number) => void)[] = [];
  private exited = false;

  report(status: ProcessStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }

  exit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.exitListeners.forEach((listener) => listener(code));
  }

  onStatus(listener: (status: ProcessStatus) => void): void {
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

function setup(options: Partial<SupervisorOptions<FakeClient>> = {}) {
  const launched: FakeProcess[] = [];
  const supervisor = new Supervisor<FakeClient>({
    name: 'The engine',
    launch: () => {
      const child = new FakeProcess();
      launched.push(child);
      return child;
    },
    restartDelaysMs: [20, 40],
    stopTimeoutMs: 50,
    ...options,
  });
  supervisor.start();
  const processAt = (index: number): FakeProcess => {
    const found = launched[index];
    if (!found) throw new Error(`No process ${index} was launched.`);
    return found;
  };
  const ping = () => supervisor.call((client) => client.ping());
  return { supervisor, launched, processAt, ping };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errors.mockRestore();
});

describe('Supervisor', () => {
  it('sends requests to the process, and hands each new connection over first', async () => {
    const connected: FakeClient[] = [];
    const { processAt, ping } = setup({ onConnect: (client) => connected.push(client) });
    expect(connected).toEqual([processAt(0).client]);
    await expect(ping()).resolves.toBe('pong');
  });

  it('says when the process is serving', () => {
    const onReady = vi.fn();
    const { processAt } = setup({ onReady });
    processAt(0).report({ type: 'ready' });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('says the process is starting until it is started', async () => {
    const supervisor = new Supervisor<FakeClient>({
      name: 'The workspace',
      launch: () => new FakeProcess(),
    });
    await expect(supervisor.call((client) => client.ping())).rejects.toThrow(
      'The workspace is starting. Try again in a moment.',
    );
  });

  it('fails calls at once while the process is down, then restarts and reconnects it', async () => {
    const connected: FakeClient[] = [];
    const { processAt, launched, ping } = setup({
      onConnect: (client) => connected.push(client),
    });
    processAt(0).exit(1);
    expect(processAt(0).client.closed).toBe(true);
    await expect(ping()).rejects.toThrow(
      'The engine stopped unexpectedly and is restarting. Try again in a moment.',
    );
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    await expect(ping()).resolves.toBe('pong');
    expect(connected).toEqual([processAt(0).client, processAt(1).client]);
    expect(errors).toHaveBeenCalledWith('The engine process exited unexpectedly (code 1).');
  });

  it('fails a request the process was answering when it exited', async () => {
    const { processAt, ping } = setup();
    processAt(0).client.hold = true;
    const pending = ping();
    await sleep(5);
    processAt(0).exit(1);
    await expect(pending).rejects.toThrow('The engine stopped while it was working on this.');
  });

  it('waits longer after each failure in a row', async () => {
    const { processAt, launched } = setup({ restartDelaysMs: [10, 200] });
    processAt(0).exit(1);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    const crashed = Date.now();
    processAt(1).exit(1);
    await sleep(100);
    expect(launched).toHaveLength(2);
    await vi.waitFor(() => expect(launched).toHaveLength(3));
    expect(Date.now() - crashed).toBeGreaterThanOrEqual(190);
  });

  it('starts the waits over once the process has run for a while', async () => {
    const { processAt, launched } = setup({ restartDelaysMs: [10, 5_000], stableAfterMs: 0 });
    processAt(0).exit(1);
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    processAt(1).exit(1);
    await vi.waitFor(() => expect(launched).toHaveLength(3), { timeout: 1_000 });
  });

  it('says why the process could not start, and keeps trying', async () => {
    const { processAt, launched, ping } = setup();
    processAt(0).report({ type: 'failed', message: 'The database is locked.' });
    expect(processAt(0).killed).toBe(true);
    await expect(ping()).rejects.toThrow(
      "The engine couldn't start: The database is locked. Architect keeps trying in the background.",
    );
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    processAt(1).report({ type: 'ready' });
    await expect(ping()).resolves.toBe('pong');
  });

  it('keeps trying when the process cannot be launched', async () => {
    let attempts = 0;
    const { ping } = setup({
      launch: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('The utility process could not be created.');
        return new FakeProcess();
      },
    });
    await expect(ping()).rejects.toThrow(
      "The engine couldn't start: The utility process could not be created.",
    );
    await vi.waitFor(() => expect(attempts).toBe(2));
    await expect(ping()).resolves.toBe('pong');
  });

  it('stops the process cleanly and never restarts it afterwards', async () => {
    const { supervisor, processAt, launched, ping } = setup();
    await supervisor.stop();
    expect(processAt(0).stopRequested).toBe(true);
    expect(processAt(0).killed).toBe(false);
    await expect(ping()).rejects.toThrow('The engine has stopped because Architect is closing.');
    supervisor.start();
    await sleep(60);
    expect(launched).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it('cancels a pending restart when it stops', async () => {
    const { supervisor, processAt, launched } = setup({ restartDelaysMs: [30] });
    processAt(0).exit(1);
    await supervisor.stop();
    await sleep(60);
    expect(launched).toHaveLength(1);
  });

  it('kills a process that does not stop in time', async () => {
    const { supervisor, processAt } = setup({ stopTimeoutMs: 20 });
    processAt(0).stopsCleanly = false;
    await supervisor.stop();
    expect(processAt(0).stopRequested).toBe(true);
    expect(processAt(0).killed).toBe(true);
  });
});
