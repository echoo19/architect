import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CurrentRound } from '../../../src/renderer/src/flow/train/CurrentRound';
import type { LiveRun } from '../../../src/renderer/src/flow/train/run-state';
import { makeAttempt, makeJob, makeRound, makeRun } from './factories';

const NAMES = { mentor: 'Spark', student: 'Glimmer' };

function live(overrides: Partial<LiveRun['run']>, extra: Partial<LiveRun> = {}): LiveRun {
  return {
    run: makeRun(overrides),
    job: makeJob(),
    lockedTestOn: 'local',
    rounds: [],
    attempts: [],
    lineage: [],
    budget: null,
    progress: null,
    mentorBusy: false,
    notice: null,
    graduateId: null,
    improves: null,
    ...extra,
  };
}

function panel(run: LiveRun, round = makeRound(2, { status: 'attempting' })): string {
  const html = renderToStaticMarkup(
    createElement(CurrentRound, {
      live: { ...run, rounds: [round] },
      round,
      names: NAMES,
      question: null,
    }),
  );
  return html.replace(/&#x27;/g, "'");
}

describe('the newest round, open under its line', () => {
  it('says what the student is working through and what the mentor waits for', () => {
    const html = panel(live({ status: 'running', phase: 'attempting' }));
    expect(html).toContain('aria-label="Current round"');
    expect(html).toContain('Working through 12 practice tasks.');
    expect(html).toContain('Waits for Glimmer to finish the practice tasks.');
  });

  it('says one practice task in the singular', () => {
    const round = makeRound(2, { status: 'attempting' });
    const attempt = makeAttempt('att_1', { round: 2, split: 'train' });
    const html = panel(
      live({ status: 'running', phase: 'attempting' }, { attempts: [attempt] }),
      round,
    );
    expect(html).toContain('Got all 1 practice task right so far this round.');
  });

  it("gives the mentor's diagnosis and what it expects once it has one", () => {
    const round = makeRound(2, {
      status: 'evaluating',
      diagnosis: 'Bookings start too early.',
      predicted: { devDeltaMin: 3, devDeltaMax: 6, rationale: 'Dates are read late.' },
    });
    const html = panel(live({ status: 'running', phase: 'evaluating' }), round);
    expect(html).toContain('Bookings start too early.');
    expect(html).toMatch(/Expects<\/dt><dd[^>]*><span[^>]*>\+3 to \+6 check tasks<\/span>/);
  });

  it('keeps only the diagnosis and the result once the run has moved on to its final test', () => {
    const round = makeRound(2, { status: 'decided', diagnosis: 'Bookings start too early.' });
    const html = panel(live({ status: 'testing', phase: 'testing' }), round);
    expect(html).toContain('Bookings start too early.');
    expect(html).not.toContain('Glimmer');
    expect(html).not.toContain('Waits for');
    expect(html).not.toContain('practice tasks');
  });

  it('says a round that never practiced is waiting for its first setup', () => {
    const run = live({ status: 'running', phase: 'diagnosing' });
    const round = makeRound(1, { status: 'diagnosing', train: { pass: 0, total: 0 } });
    const html = panel(run, round);
    expect(html).toContain('No practice this round. It waits for its first setup.');
    expect(html).toContain(
      "Writing Glimmer's first full setup from the job and its example tasks.",
    );
  });
});
