import { AdapterError, type AdapterErrorCode } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../../src/http/errors';
import { defaultSleep, withRetries, type RetryOptions } from '../../src/http/retry';

function recorder(overrides: RetryOptions = {}): { options: RetryOptions; delays: number[] } {
  const delays: number[] = [];
  const options: RetryOptions = {
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0,
    ...overrides,
  };
  return { options, delays };
}

function failing(code: AdapterErrorCode, status?: number, retryAfterMs?: number): HttpError {
  return new HttpError({ code, summary: `${code} failure` }, { status, retryAfterMs });
}

/** An operation that throws each queued error in turn, then returns "ok". */
function flaky(...errors: unknown[]): { run: () => Promise<string>; calls: () => number } {
  let calls = 0;
  return {
    run: async () => {
      const error = errors[calls++];
      if (error !== undefined) throw error;
      return 'ok';
    },
    calls: () => calls,
  };
}

describe('withRetries', () => {
  it('returns the first result without waiting', async () => {
    const { options, delays } = recorder();
    const op = flaky();
    expect(await withRetries(op.run, options)).toBe('ok');
    expect(op.calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  it('backs off exponentially from 0.5 s', async () => {
    const { options, delays } = recorder();
    const op = flaky(failing('server', 503), failing('network'), failing('rate_limit', 429));
    expect(await withRetries(op.run, options)).toBe('ok');
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it('adds up to one base delay of jitter', async () => {
    const { options, delays } = recorder({ random: () => 0.5 });
    await withRetries(flaky(failing('server', 500), failing('server', 500)).run, options);
    expect(delays).toEqual([750, 1250]);
  });

  it('gives up after five attempts and raises the last error', async () => {
    const { options, delays } = recorder();
    const errors = [1, 2, 3, 4, 5].map(
      (n) => new HttpError({ code: 'server', summary: `try ${n}` }),
    );
    const op = flaky(...errors);
    await expect(withRetries(op.run, options)).rejects.toBe(errors[4]);
    expect(op.calls()).toBe(5);
    expect(delays).toEqual([500, 1000, 2000, 4000]);
  });

  it('honours a custom attempt limit', async () => {
    const { options } = recorder({ maxAttempts: 1 });
    const op = flaky(failing('server', 503));
    await expect(withRetries(op.run, options)).rejects.toBeInstanceOf(AdapterError);
    expect(op.calls()).toBe(1);
  });

  it('waits at least as long as Retry-After asks', async () => {
    const { options, delays } = recorder();
    await withRetries(
      flaky(failing('rate_limit', 429, 7000), failing('server', 503, 100)).run,
      options,
    );
    expect(delays).toEqual([7000, 1000]);
  });

  it('does not wait out a Retry-After beyond the ceiling', async () => {
    const { options, delays } = recorder();
    const error = failing('rate_limit', 429, 600_000);
    const op = flaky(error);
    await expect(withRetries(op.run, options)).rejects.toBe(error);
    expect(op.calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  it.each([
    'auth',
    'quota',
    'not_found',
    'bad_request',
    'bad_response',
    'aborted',
    'blocked',
  ] as const)('never retries %s', async (code) => {
    const { options, delays } = recorder();
    const op = flaky(failing(code));
    await expect(withRetries(op.run, options)).rejects.toMatchObject({ code });
    expect(op.calls()).toBe(1);
    expect(delays).toEqual([]);
  });

  it('does not repeat a 504, which means the request itself ran too long', async () => {
    const { options } = recorder();
    const op = flaky(failing('server', 504));
    await expect(withRetries(op.run, options)).rejects.toMatchObject({ status: 504 });
    expect(op.calls()).toBe(1);
  });

  it('does not retry errors that are not adapter errors', async () => {
    const { options } = recorder();
    const op = flaky(new TypeError('a bug'));
    await expect(withRetries(op.run, options)).rejects.toBeInstanceOf(TypeError);
    expect(op.calls()).toBe(1);
  });

  it('stops before starting when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const op = flaky();
    await expect(withRetries(op.run, recorder().options, controller.signal)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(op.calls()).toBe(0);
  });

  it('stops retrying once the signal aborts during a wait', async () => {
    const controller = new AbortController();
    const options: RetryOptions = {
      sleep: async (_ms, signal) => {
        controller.abort();
        await defaultSleep(60_000, signal);
      },
      random: () => 0,
    };
    const op = flaky(failing('server', 503), failing('server', 503));
    await expect(withRetries(op.run, options, controller.signal)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(op.calls()).toBe(1);
  });
});

describe('defaultSleep', () => {
  it('resolves after the delay', async () => {
    const started = Date.now();
    await defaultSleep(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('rejects as soon as the signal aborts', async () => {
    const controller = new AbortController();
    const sleeping = defaultSleep(60_000, controller.signal);
    controller.abort();
    await expect(sleeping).rejects.toMatchObject({ code: 'aborted' });
  });

  it('rejects at once for a signal that is already aborted', async () => {
    await expect(defaultSleep(60_000, AbortSignal.abort())).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});
