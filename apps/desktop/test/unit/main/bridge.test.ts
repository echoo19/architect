import { describe, expect, it, vi } from 'vitest';
import { createBridge } from '../../../src/common/bridge';
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
