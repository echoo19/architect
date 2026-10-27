import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@architect/shared';
import { failureLine } from '../../../src/renderer/src/flow/train/failure-line';
import {
  activeProgress,
  budgetMeters,
  changeCounts,
  currentRound,
  hasKeptChange,
  initialLiveRunState,
  latestFailure,
  liveRunReducer,
  medianLatencyMs,
  RECENT_ATTEMPT_LIMIT,
  type LiveRun,
  type LiveRunState,
} from '../../../src/renderer/src/flow/train/run-state';
import {
  AT,
  at,
  attemptFinished,
  decided,
  makeAttempt,
  makeDetail,
  makeRound,
  makeRun,
  roundUpdated,
  runUpdated,
} from './factories';

function live(state: LiveRunState): LiveRun {
  if (state.status !== 'live') throw new Error(`Expected a live state, got ${state.status}`);
  return state.live;
}

function loaded(...events: RunEvent[]): LiveRun {
  const start = liveRunReducer(initialLiveRunState, { type: 'snapshot', detail: makeDetail() });
  return live(
    events.reduce((state, event) => liveRunReducer(state, { type: 'event', event }), start),
  );
}

describe('liveRunReducer', () => {
  it('holds events that arrive before the snapshot and replays them on top of it', () => {
    const newer = makeRun({ phase: 'diagnosing', updatedAt: at(5) });
    let state = liveRunReducer(initialLiveRunState, { type: 'event', event: runUpdated(newer) });
    state = liveRunReducer(state, { type: 'event', event: roundUpdated(makeRound(1)) });
    expect(state).toMatchObject({ status: 'loading' });

    state = liveRunReducer(state, { type: 'snapshot', detail: makeDetail() });
    expect(live(state).run.phase).toBe('diagnosing');
    expect(live(state).rounds.map((round) => round.index)).toEqual([1]);
  });

  it('keeps the snapshot when a replayed update is older than it', () => {
    const older = makeRun({ phase: 'preparing', updatedAt: at(-5) });
    let state = liveRunReducer(initialLiveRunState, { type: 'event', event: runUpdated(older) });
    state = liveRunReducer(state, {
      type: 'snapshot',
      detail: makeDetail({ run: makeRun({ phase: 'evaluating' }) }),
    });
    expect(live(state).run.phase).toBe('evaluating');
  });

  it('keeps pending events across a failed load and replays them after a retry', () => {
    let state = liveRunReducer(initialLiveRunState, {
      type: 'event',
      event: runUpdated(makeRun({ phase: 'testing', updatedAt: at(1) })),
    });
    state = liveRunReducer(state, { type: 'failed', error: new Error('Engine busy') });
    expect(state).toMatchObject({ status: 'error', pending: [expect.anything()] });
    state = liveRunReducer(state, { type: 'loading' });
    state = liveRunReducer(state, { type: 'snapshot', detail: makeDetail() });
    expect(live(state).run.phase).toBe('testing');
  });

  it('ignores events for other runs', () => {
    const other = makeRun({ id: 'run_other', phase: 'testing', updatedAt: at(9) });
    expect(loaded(runUpdated(other)).run.phase).toBe('attempting');
  });

  it('moves a round forward but never back to an earlier step', () => {
    const evaluating = makeRound(2, { status: 'evaluating', title: 'Cents, not dollars' });
    const lateCopy = makeRound(2, { status: 'diagnosing' });
    const result = loaded(roundUpdated(evaluating), roundUpdated(lateCopy));
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]).toMatchObject({ status: 'evaluating', title: 'Cents, not dollars' });
  });

  it('keeps rounds in order whatever order they arrive in', () => {
    const result = loaded(roundUpdated(makeRound(3)), roundUpdated(makeRound(1)));
    expect(result.rounds.map((round) => round.index)).toEqual([1, 3]);
  });

  it('lists practice and check attempts newest first, once each, with their requests', () => {
    const first = makeAttempt('att_1');
    const second = makeAttempt('att_2', { split: 'dev', round: null });
    const result = loaded(
      attemptFinished(first, 'Price job 4410'),
      attemptFinished(second),
      attemptFinished(first, 'Price job 4410'),
    );
    expect(result.attempts.map((attempt) => attempt.id)).toEqual(['att_2', 'att_1']);
    expect(result.attempts[1]?.prompt).toBe('Price job 4410');
  });

  it('never lists locked test attempts', () => {
    const result = loaded(attemptFinished(makeAttempt('att_t', { split: 'test', round: null })));
    expect(result.attempts).toEqual([]);
  });

  it('keeps only the most recent attempts', () => {
    const events = Array.from({ length: RECENT_ATTEMPT_LIMIT + 5 }, (_, index) =>
      attemptFinished(makeAttempt(`att_${index}`)),
    );
    const result = loaded(...events);
    expect(result.attempts).toHaveLength(RECENT_ATTEMPT_LIMIT);
    expect(result.attempts[0]?.id).toBe(`att_${RECENT_ATTEMPT_LIMIT + 4}`);
  });

  it('tracks the mentor, evaluation progress, budget and the graduate', () => {
    const base = { runId: 'run_1', at: AT } as const;
    const busy = loaded({ ...base, type: 'mentor.started', round: 1 });
    expect(busy.mentorBusy).toBe(true);

    const result = loaded(
      { ...base, type: 'mentor.started', round: 1 },
      {
        ...base,
        type: 'mentor.finished',
        round: 1,
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: 0.01,
      },
      {
        ...base,
        type: 'eval.progress',
        split: 'dev',
        harnessVersion: 2,
        done: 8,
        total: 40,
        pass: 5,
      },
      {
        ...base,
        type: 'budget',
        state: {
          rounds: { used: 1, max: 12 },
          usd: { used: 0.4, max: 5 },
          minutes: { used: 30, max: 180 },
        },
      },
      { ...base, type: 'graduate.ready', graduateId: 'grd_1' },
    );
    expect(result.mentorBusy).toBe(false);
    expect(result.progress).toEqual({ split: 'dev', done: 8, total: 40 });
    expect(result.budget?.usd).toEqual({ used: 0.4, max: 5 });
    expect(result.graduateId).toBe('grd_1');

    const finished = loaded({
      ...base,
      type: 'eval.finished',
      split: 'dev',
      harnessVersion: 2,
      score: { pass: 20, total: 40 },
      perType: [],
    });
    expect(finished.progress).toBeNull();
  });

  it('shows the latest warning until the phase changes', () => {
    const base = { runId: 'run_1', at: AT } as const;
    const warned = loaded(
      { ...base, type: 'log', level: 'info', message: 'Round 1 started' },
      { ...base, type: 'log', level: 'warn', message: 'The mentor timed out; retrying.' },
    );
    expect(warned.notice).toEqual({ level: 'warn', message: 'The mentor timed out; retrying.' });

    const moved = loaded(
      { ...base, type: 'log', level: 'warn', message: 'Slow reply' },
      runUpdated(makeRun({ phase: 'diagnosing', updatedAt: at(1) })),
    );
    expect(moved.notice).toBeNull();
  });
});

describe('failureLine', () => {
  const failed = makeAttempt('a', {
    check: { pass: false, reason: 'Total is off by $36.00.' },
    answerSummary: '$1,248.50',
    expectedSummary: '$1,284.50',
  });

  it('sets the answer against the right one, ending the sentence once', () => {
    expect(failureLine({ ...failed, prompt: 'Price job J-4412.' })).toBe(
      'Missed "Price job J-4412.": answered $1,248.50, but the right answer is $1,284.50.',
    );
    expect(
      failureLine({ ...failed, expectedSummary: 'Tue 09:30, Priya N.', prompt: 'Book it' }),
    ).toBe('Missed "Book it": answered $1,248.50, but the right answer is Tue 09:30, Priya N.');
  });

  it("falls back to the checker's reason when there is no short answer", () => {
    const bare = makeAttempt('b', { check: { pass: false, reason: 'No ANSWER line' } });
    expect(failureLine(bare)).toBe('Missed task task_b: No ANSWER line.');
  });
});

describe('training view selectors', () => {
  it('finds the current round and its newest failing practice task', () => {
    const result = loaded(
      roundUpdated(makeRound(1)),
      roundUpdated(makeRound(2, { status: 'attempting' })),
      attemptFinished(
        makeAttempt('a', { round: 2, check: { pass: false, reason: 'Wrong total.' } }),
      ),
      attemptFinished(makeAttempt('b', { round: 2 })),
      attemptFinished(makeAttempt('c', { round: 1, check: { pass: false, reason: 'Late.' } })),
    );
    expect(currentRound(result)?.index).toBe(2);
    expect(latestFailure(result, 2)?.id).toBe('a');
    expect(latestFailure(result, 3)).toBeNull();
  });

  it('takes the median answer time of recent attempts', () => {
    const attempts = [3000, 1000, 2000, 9000].map((latencyMs, index) =>
      makeAttempt(`a${index}`, { latencyMs }),
    );
    expect(medianLatencyMs(attempts)).toBe(2500);
    expect(medianLatencyMs(attempts.slice(0, 3))).toBe(2000);
    expect(medianLatencyMs([])).toBeNull();
  });

  it('counts kept changes out of the ones that were decided', () => {
    const rounds = [decided(1, 16, 23), decided(2, 23, 22), makeRound(3, { status: 'evaluating' })];
    expect(changeCounts(rounds)).toEqual({ kept: 1, tried: 2 });
    expect(hasKeptChange(rounds)).toBe(true);
    expect(hasKeptChange([decided(1, 16, 16)])).toBe(false);
  });

  it('reads the budget from the engine when it has reported one, else from the totals', () => {
    const result = loaded();
    expect(budgetMeters(result)).toEqual({
      minutes: { used: 0, max: 180 },
      usd: { used: 0, max: 5 },
      rounds: { used: 0, max: 12 },
    });
  });

  it('only shows evaluation progress for what the run is doing now', () => {
    const base = { runId: 'run_1', at: AT, harnessVersion: 1, pass: 0 } as const;
    const checking = loaded(runUpdated(makeRun({ phase: 'evaluating', updatedAt: at(1) })), {
      ...base,
      type: 'eval.progress',
      split: 'dev',
      done: 3,
      total: 40,
    });
    expect(activeProgress(checking)).toEqual({ split: 'dev', done: 3, total: 40 });

    const moved = loaded(
      { ...base, type: 'eval.progress', split: 'dev', done: 3, total: 40 },
      runUpdated(makeRun({ phase: 'diagnosing', updatedAt: at(1) })),
    );
    expect(activeProgress(moved)).toBeNull();
  });
});
