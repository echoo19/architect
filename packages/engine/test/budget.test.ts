import { GuardError } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { BudgetGuard } from '../src/loop/budget';
import { ManualClock } from './fakes/clock';

const budget = { maxRounds: 3, maxMentorUsd: 1, maxWallMinutes: 10 };
const MINUTE = 60_000;

function guard(used = { rounds: 0, usd: 0, wallMs: 0 }) {
  const clock = new ManualClock();
  return { clock, guard: new BudgetGuard(budget, used, clock) };
}

describe('BudgetGuard', () => {
  it('authorizes a mentor call that fits and returns the amount', () => {
    const { guard: g } = guard();
    expect(g.authorizeMentorCall(0.4)).toBe(0.4);
    g.recordSpend(0.4);
    expect(g.authorizeMentorCall(0.6)).toBe(0.6);
  });

  it('refuses a mentor call that could cross the dollar cap', () => {
    const { guard: g } = guard({ rounds: 0, usd: 0.7, wallMs: 0 });
    const refusal = (() => {
      try {
        g.authorizeMentorCall(0.31);
      } catch (error) {
        return error;
      }
    })();
    expect(refusal).toBeInstanceOf(GuardError);
    expect((refusal as GuardError).guard).toBe('budget');
    expect((refusal as GuardError).message).toContain('$0.30 left');
  });

  it('refuses a call whose price is unknown, because the cap could not be enforced', () => {
    const { guard: g } = guard();
    expect(() => g.authorizeMentorCall(null)).toThrow(GuardError);
  });

  it('caps rounds', () => {
    const { guard: g } = guard({ rounds: 2, usd: 0, wallMs: 0 });
    expect(g.roundsSpent()).toBe(false);
    g.recordRound();
    expect(g.roundsSpent()).toBe(true);
    expect(g.left().rounds).toBe(0);
  });

  it('counts wall time only while active, so paused time is excluded', () => {
    const { clock, guard: g } = guard({ rounds: 0, usd: 0, wallMs: 2 * MINUTE });
    g.resume();
    clock.advance(3 * MINUTE);
    g.pause();
    clock.advance(60 * MINUTE);
    expect(g.wallMs()).toBe(5 * MINUTE);
    g.resume();
    clock.advance(4 * MINUTE);
    expect(g.wallClockSpent()).toBe(false);
    clock.advance(MINUTE);
    expect(g.wallMs()).toBe(10 * MINUTE);
    expect(g.wallClockSpent()).toBe(true);
  });

  it('reports its state for budget events', () => {
    const { clock, guard: g } = guard({ rounds: 1, usd: 0.25, wallMs: 0 });
    g.resume();
    clock.advance(90_000);
    expect(g.state()).toEqual({
      rounds: { used: 1, max: 3 },
      usd: { used: 0.25, max: 1 },
      minutes: { used: 1.5, max: 10 },
    });
    expect(g.left()).toEqual({ rounds: 2, usd: 0.75, minutes: 8.5 });
  });
});
