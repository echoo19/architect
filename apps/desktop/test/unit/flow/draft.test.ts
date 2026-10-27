import { describe, expect, it } from 'vitest';
import { isDraftRound } from '../../../src/renderer/src/flow/train/draft';
import { makeJob, makeRound } from './factories';

const blank = makeJob({ startingHarness: { kind: 'blank' } });
const template = makeJob({ startingHarness: { kind: 'template', template: 'ops-analyst' } });

describe('isDraftRound', () => {
  const draft = makeRound(1, { status: 'diagnosing', train: { pass: 0, total: 0 } });

  it('finds the first round of a blank start, which writes a whole draft', () => {
    expect(isDraftRound(draft, 'architect', blank)).toBe(true);
    expect(isDraftRound(draft, 'self_reflection', blank)).toBe(true);
    expect(isDraftRound({ ...draft, status: 'decided' }, 'architect', blank)).toBe(true);
  });

  it('leaves later rounds, other starts and older practiced rounds as ordinary changes', () => {
    expect(isDraftRound({ ...draft, index: 2 }, 'architect', blank)).toBe(false);
    expect(isDraftRound(draft, 'architect', template)).toBe(false);
    expect(isDraftRound(draft, 'bare', blank)).toBe(false);
    const practiced = { ...draft, status: 'decided' as const, train: { pass: 7, total: 12 } };
    expect(isDraftRound(practiced, 'architect', blank)).toBe(false);
    expect(isDraftRound({ ...draft, status: 'attempting' }, 'architect', blank)).toBe(false);
  });

  it('counts the one-shot method’s only round as its draft', () => {
    expect(isDraftRound(draft, 'one_shot', template)).toBe(true);
  });
});
