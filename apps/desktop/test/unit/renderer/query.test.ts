import { describe, expect, it } from 'vitest';
import {
  fetchQuery,
  peekQuery,
  readsOnMount,
  type QueryEntry,
} from '../../../src/renderer/src/api/query';

/** A read that finishes when the test says so. */
function gate() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Lets every promise that can settle without the test's help do so. */
const settled = () => new Promise<void>((done) => setTimeout(done, 0));

/** A fetcher that hands out the planned reads in order, and says how many have been started. */
function planned(...gates: ReturnType<typeof gate>[]) {
  let started = 0;
  return {
    started: () => started,
    fetcher: () => {
      const next = gates[started];
      started += 1;
      if (!next) throw new Error('A read nobody planned for was started.');
      return next.promise;
    },
  };
}

describe('reading a key', () => {
  it('keeps what a read returned, and keeps it through a read that fails', async () => {
    await fetchQuery('plain', () => Promise.resolve('first'));
    expect(peekQuery('plain')).toEqual({ status: 'success', data: 'first' });

    await fetchQuery('plain', () => Promise.reject(new Error('The engine is busy.')));
    expect(peekQuery('plain')).toMatchObject({
      status: 'error',
      data: 'first',
      error: { message: 'The engine is busy.' },
    });
  });

  it('turns a fetcher that throws before it starts into an error, not a throw', async () => {
    await fetchQuery('throws', () => {
      throw new Error('No bridge.');
    });
    expect(peekQuery('throws')).toMatchObject({
      status: 'error',
      error: { message: 'No bridge.' },
    });
  });

  it('shows what was cached while it reads again', async () => {
    await fetchQuery('again', () => Promise.resolve('old'));
    const next = gate();
    const reading = fetchQuery('again', () => next.promise);
    expect(peekQuery('again')).toEqual({ status: 'loading', data: 'old' });
    next.resolve('new');
    await reading;
    expect(peekQuery('again')).toEqual({ status: 'success', data: 'new' });
  });

  it('starts a read of its own when asked after the last one landed', async () => {
    const [first, second] = [gate(), gate()];
    const run = planned(first, second);
    const one = fetchQuery('apart', run.fetcher);
    first.resolve('one');
    await one;
    const two = fetchQuery('apart', run.fetcher);
    second.resolve('two');
    await two;
    expect(run.started()).toBe(2);
    expect(peekQuery('apart')).toEqual({ status: 'success', data: 'two' });
  });
});

describe('asking for a read while one is under way', () => {
  it('waits for the one under way to land, then reads again, since it may have started too soon', async () => {
    const [older, newer] = [gate(), gate()];
    const run = planned(older, newer);
    const reading = fetchQuery('during', run.fetcher);
    const asked = fetchQuery('during', run.fetcher);
    // The same read answers both asks, and the new one has not started yet.
    expect(asked).toBe(reading);
    expect(run.started()).toBe(1);

    older.resolve('read before the change');
    await settled();
    expect(run.started()).toBe(2);
    newer.resolve('read after the change');
    await reading;
    expect(peekQuery('during')).toEqual({ status: 'success', data: 'read after the change' });
  });

  it("never shows the first read's answer as the current one", async () => {
    const [older, newer] = [gate(), gate()];
    const run = planned(older, newer);
    const reading = fetchQuery('dropped', run.fetcher);
    void fetchQuery('dropped', run.fetcher);

    older.resolve('read before the change');
    await settled();
    // Still reading: the answer that landed is not what readers are shown.
    expect(peekQuery('dropped')).toEqual({ status: 'loading', data: undefined });
    newer.resolve('read after the change');
    await reading;
    expect(peekQuery('dropped')).toEqual({ status: 'success', data: 'read after the change' });
  });

  it('makes whoever asked wait for the newest read, not the one under way', async () => {
    const [older, newer] = [gate(), gate()];
    const run = planned(older, newer);
    void fetchQuery('waits', run.fetcher);
    let landed = false;
    void fetchQuery('waits', run.fetcher).then(() => {
      landed = true;
    });

    older.resolve('old');
    await settled();
    expect(landed).toBe(false);
    newer.resolve('new');
    await settled();
    expect(landed).toBe(true);
  });

  it('shares one more read between all the asks made during the same read', async () => {
    const [first, second] = [gate(), gate()];
    const run = planned(first, second);
    const reading = fetchQuery('shared', run.fetcher);
    for (let ask = 0; ask < 4; ask += 1) void fetchQuery('shared', run.fetcher);

    first.resolve('one');
    await settled();
    expect(run.started()).toBe(2);
    second.resolve('two');
    await reading;
    expect(run.started()).toBe(2);
    expect(peekQuery('shared')).toEqual({ status: 'success', data: 'two' });
  });

  it('reads again for an ask made during the read that was itself asked for', async () => {
    const [first, second, third] = [gate(), gate(), gate()];
    const run = planned(first, second, third);
    const reading = fetchQuery('chain', run.fetcher);
    void fetchQuery('chain', run.fetcher);
    first.resolve('one');
    await settled();
    // The second read is under way now; an ask during it is another one more.
    void fetchQuery('chain', run.fetcher);
    second.resolve('two');
    await settled();
    expect(run.started()).toBe(3);
    third.resolve('three');
    await reading;
    expect(peekQuery('chain')).toEqual({ status: 'success', data: 'three' });
  });

  it('drops a failure of the older read when the newer one lands', async () => {
    const [older, newer] = [gate(), gate()];
    const run = planned(older, newer);
    const reading = fetchQuery('recovers', run.fetcher);
    void fetchQuery('recovers', run.fetcher);
    older.reject(new Error('The engine was starting.'));
    await settled();
    newer.resolve('fine');
    await reading;
    expect(peekQuery('recovers')).toEqual({ status: 'success', data: 'fine' });
  });

  it('ends with the failure of the newest read, whatever the older one found', async () => {
    const [older, newer] = [gate(), gate()];
    const run = planned(older, newer);
    const reading = fetchQuery('fails', run.fetcher);
    void fetchQuery('fails', run.fetcher);
    older.resolve('fine');
    await settled();
    newer.reject(new Error('The engine stopped.'));
    await reading;
    expect(peekQuery('fails')).toMatchObject({
      status: 'error',
      error: { message: 'The engine stopped.' },
    });
  });
});

describe('what a component does when it comes on screen', () => {
  const read: QueryEntry = { status: 'success', data: 'kept' };
  const reading: QueryEntry = { status: 'loading', data: 'kept' };
  const failed: QueryEntry = { status: 'error', error: new Error('The engine was busy.') };

  it('reads a key nothing has read yet, whatever it asks for', () => {
    expect(readsOnMount(undefined, false)).toBe(true);
    expect(readsOnMount(undefined, true)).toBe(true);
  });

  it('leaves a key that was read alone, unless it is to be read again each time', () => {
    expect(readsOnMount(read, false)).toBe(false);
    expect(readsOnMount(read, true)).toBe(true);
  });

  it('reads a failed key again when it is to be read again each time, and leaves it alone otherwise', () => {
    expect(readsOnMount(failed, true)).toBe(true);
    expect(readsOnMount(failed, false)).toBe(false);
  });

  it('joins a read that is already under way instead of starting another', () => {
    expect(readsOnMount(reading, true)).toBe(false);
    expect(readsOnMount(reading, false)).toBe(false);
  });
});
