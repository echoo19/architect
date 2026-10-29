import { CodedError } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { createBridge, withTypedFailures } from '../../../src/common/bridge';
import { DOMAINS, eventMethods, invokeChannels, invokeMethods } from '../../../src/common/ipc';

function transport(reply: unknown = { ok: true, value: 'done' }) {
  return {
    invoke: vi.fn(async () => reply),
    subscribe: vi.fn(() => vi.fn()),
  };
}

describe('createBridge', () => {
  it('exposes every method of the contract', () => {
    const api = createBridge(transport()) as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(api).sort()).toEqual([...DOMAINS].sort());
    for (const domain of DOMAINS) {
      for (const method of [...invokeMethods(domain), ...eventMethods(domain)]) {
        expect(typeof api[domain]?.[method], `${domain}.${method}`).toBe('function');
      }
    }
    expect(invokeChannels()).toContain('workspace:decide');
  });

  it('calls one channel per method and unwraps the reply', async () => {
    const fake = transport({ ok: true, value: { pass: 3 } });
    const api = createBridge(fake);
    await expect(api.jobs.draftReply('ses_1', 'yes')).resolves.toEqual({ pass: 3 });
    expect(fake.invoke).toHaveBeenCalledWith('jobs:draftReply', ['ses_1', 'yes']);
  });

  it('rejects with the main process message on failure', async () => {
    const api = createBridge(transport({ ok: false, error: { message: 'No such job.' } }));
    await expect(api.jobs.get('job_x')).rejects.toThrow('No such job.');
  });

  it('carries the code of a failure on the end of its message, which the renderer reads back', async () => {
    const coded = createBridge(
      transport({
        ok: false,
        error: { message: 'There is no job "job_x".', code: 'job_not_found' },
      }),
    );
    // What Electron's context bridge hands the renderer: an error with the message alone.
    const received = await coded.jobs.get('job_x').catch((error: unknown) => error);
    expect(received).toBeInstanceOf(Error);
    expect(received).not.toBeInstanceOf(CodedError);
    expect((received as Error).message.startsWith('There is no job "job_x".')).toBe(true);

    const typed = withTypedFailures(coded);
    const error = await typed.jobs.get('job_x').catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(CodedError);
    expect(error).toMatchObject({ code: 'job_not_found', message: 'There is no job "job_x".' });
  });

  it('leaves a failure without a code, and every success, as it was', async () => {
    const failing = withTypedFailures(
      createBridge(transport({ ok: false, error: { message: 'No such job.' } })),
    );
    const error = await failing.jobs.get('job_x').catch((failure: unknown) => failure);
    expect(error).not.toBeInstanceOf(CodedError);
    expect(error).toMatchObject({ message: 'No such job.' });

    const fake = transport({ ok: true, value: { pass: 3 } });
    const api = withTypedFailures(createBridge(fake));
    await expect(api.jobs.draftReply('ses_1', 'yes')).resolves.toEqual({ pass: 3 });
    const listener = vi.fn();
    api.runs.onEvent(listener);
    expect(fake.subscribe).toHaveBeenCalledWith('runs:onEvent', listener);
  });

  it('works on a bridge that only has some of its domains', async () => {
    const partial = { graduates: { publications: async () => [] } };
    const api = withTypedFailures(partial as never);
    await expect(api.graduates.publications('grd_1')).resolves.toEqual([]);
  });

  it('rejects replies that are not envelopes', async () => {
    const api = createBridge(transport('raw'));
    await expect(api.app.info()).rejects.toThrow("couldn't read");
  });

  it('subscribes to events and returns the unsubscribe function', () => {
    const fake = transport();
    const api = createBridge(fake);
    const listener = vi.fn();
    const unsubscribe = api.runs.onEvent(listener);
    expect(fake.subscribe).toHaveBeenCalledWith('runs:onEvent', listener);
    unsubscribe();
    const returned = fake.subscribe.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    expect(returned).toHaveBeenCalledOnce();
  });
});
