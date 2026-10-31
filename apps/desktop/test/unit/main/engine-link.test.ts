import { describe, expect, it, vi } from 'vitest';
import {
  answerSecretLookups,
  asEnginePort,
  askForSecrets,
  EngineStatusSchema,
  ParentMessageSchema,
  type PortMain,
} from '../../../src/utility/link';
import { channel } from './channel';

describe('secret lookups between the engine and main', () => {
  function connect(lookup: (ref: string) => Promise<string | undefined>, timeoutMs?: number) {
    const [mainSide, engineSide] = channel();
    answerSecretLookups(mainSide, lookup);
    return askForSecrets(engineSide, timeoutMs);
  }

  it('returns the value main has, or nothing', async () => {
    const getSecret = connect(async (ref) => (ref === 'meta' ? 'sk-meta' : undefined));
    await expect(getSecret('meta')).resolves.toBe('sk-meta');
    await expect(getSecret('modal')).resolves.toBeUndefined();
  });

  it("passes on main's reason when a lookup fails", async () => {
    const getSecret = connect(async () => {
      throw new Error("The saved Meta Model API key can't be decrypted on this computer.");
    });
    await expect(getSecret('meta')).rejects.toThrow("can't be decrypted on this computer");
  });

  it('gives up when main does not answer', async () => {
    const [, engineSide] = channel();
    const getSecret = askForSecrets(engineSide, 20);
    await expect(getSecret('meta')).rejects.toThrow(
      `Architect didn't answer the lookup of the "meta" key in time.`,
    );
  });

  it('ignores messages that are not lookups or answers', async () => {
    const [mainSide, engineSide] = channel();
    const lookup = vi.fn(async () => 'sk-meta');
    answerSecretLookups(mainSide, lookup);
    engineSide.postMessage({ kind: 'request', id: 1, method: 'jobs.list', params: [] });
    const getSecret = askForSecrets(engineSide);
    mainSide.postMessage({ id: 1, value: 'not a reply' });
    await expect(getSecret('meta')).resolves.toBe('sk-meta');
    expect(lookup).toHaveBeenCalledOnce();
  });
});

describe('asEnginePort', () => {
  it('starts the port once someone listens, and hands over the message data', () => {
    const listeners: ((event: { data: unknown }) => void)[] = [];
    const port: PortMain & { started: number; sent: unknown[] } = {
      started: 0,
      sent: [],
      postMessage(message) {
        this.sent.push(message);
      },
      on(_event, listener) {
        listeners.push(listener);
      },
      start() {
        this.started += 1;
      },
    };
    const engine = asEnginePort(port);
    const received: unknown[] = [];
    engine.onMessage((message) => received.push(message));
    listeners.forEach((listener) => listener({ data: { kind: 'event' } }));
    engine.postMessage({ kind: 'request' });

    expect(port.started).toBe(1);
    expect(received).toEqual([{ kind: 'event' }]);
    expect(port.sent).toEqual([{ kind: 'request' }]);
  });
});

describe('messages between main and the engine process', () => {
  it('accept a start, a stop and the two statuses, and nothing else', () => {
    const start = {
      type: 'start',
      dataDir: '/data',
      sandboxEntryPath: '/app/out/sandbox/child.mjs',
      sampleJobFile: '/app/sample-job/job.json',
      academyJobFile: '/app/academy-job/job.json',
      sweepDeskJobFile: '/app/sweep-desk-job/job.json',
      assayJobFile: '/app/assay-job/job.json',
      sampleAgentFile: '/app/sample-agent/returns-desk.architect.zip',
      sampleAgentDataDir: '/app/sample-agent/data',
      trainerDir: '/app/trainer',
    };
    expect(ParentMessageSchema.parse(start)).toEqual(start);
    // The ready-made agent's two paths are part of the start, as the sample job's file is.
    expect(ParentMessageSchema.safeParse({ ...start, sampleAgentFile: undefined }).success).toBe(
      false,
    );
    expect(ParentMessageSchema.safeParse({ ...start, sampleAgentDataDir: undefined }).success).toBe(
      false,
    );
    expect(ParentMessageSchema.parse({ type: 'stop' })).toEqual({ type: 'stop' });
    expect(ParentMessageSchema.safeParse({ type: 'start', dataDir: '/data' }).success).toBe(false);
    expect(EngineStatusSchema.parse({ type: 'failed', message: 'locked' })).toEqual({
      type: 'failed',
      message: 'locked',
    });
    expect(EngineStatusSchema.safeParse({ type: 'crashed' }).success).toBe(false);
  });
});
