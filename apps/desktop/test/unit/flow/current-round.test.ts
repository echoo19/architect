import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CurrentRound, practiceCells } from '../../../src/renderer/src/flow/train/CurrentRound';
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
  it('lists the tries of a round that probes, each with what it did to the check tasks', () => {
    const predicted = { devDeltaMin: 1, devDeltaMax: 2, rationale: 'Two types.' };
    const round = makeRound(2, {
      status: 'composing',
      train: { pass: 0, total: 12 },
      probes: [
        {
          index: 1,
          title: 'Add the invoice rule',
          diagnosis: 'Totals skip labor.',
          files: ['AGENTS.md'],
          predicted,
          version: 3,
          devBefore: { pass: 4, total: 10 },
          devAfter: { pass: 6, total: 10 },
          train: { pass: 4, total: 12 },
        },
        {
          index: 2,
          title: 'Add the overdue rule',
          diagnosis: 'Balances miss the grace days.',
          files: ['skills/overdue/SKILL.md'],
          predicted,
          version: 4,
          devBefore: { pass: 4, total: 10 },
          devAfter: { pass: 3, total: 10 },
          train: { pass: 2, total: 12 },
        },
        {
          index: 3,
          title: 'A helper for totals',
          diagnosis: 'Sums by hand go wrong.',
          files: ['tools/total.js'],
          predicted,
          refused: "tools/total.js doesn't load",
        },
      ],
    });
    // A try's practice attempts are its own, not the round's.
    const own = makeAttempt('att_1', { round: 2, split: 'train', harnessVersion: 2 });
    const tried = makeAttempt('att_2', {
      round: 2,
      split: 'train',
      harnessVersion: 3,
      check: { pass: false, reason: 'Wrong total.' },
    });
    const html = panel(
      live({ status: 'running', phase: 'diagnosing' }, { attempts: [tried, own] }),
      round,
    );
    expect(html).toContain('Making one change from what the 3 tries did.');
    expect(html).toMatch(/Tries<\/dt>/);
    expect(html).toContain('>+2</span>');
    expect(html).toContain('>\u22121</span>');
    expect(html).toContain('Add the overdue rule');
    expect(html).toContain('aria-label="Refused"');
    expect(html).not.toContain('Wrong total.');
    expect(html).not.toContain('\u00b7');
  });

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
    expect(html).toContain('Got its first practice task right this round.');
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

describe("the round's practice tasks, one cell each", () => {
  const attempting = makeRound(2, { status: 'attempting', train: { pass: 0, total: 0 } });

  it('lists the answers so far in the order they came, then the tasks still to answer', () => {
    const attempts = [
      makeAttempt('att_3', { round: 2, check: { pass: true, reason: 'Matches.' } }),
      makeAttempt('att_2', { round: 2, check: { pass: false, reason: 'Wrong total.' } }),
      makeAttempt('att_1', { round: 2, check: { pass: true, reason: 'Matches.' } }),
      makeAttempt('att_0', { round: 1, check: { pass: false, reason: 'Another round.' } }),
    ];
    const cells = practiceCells(live({}, { attempts }), attempting);
    expect(cells.slice(0, 3)).toEqual(['pass', 'fail', 'pass']);
    expect(cells).toHaveLength(12);
    expect(cells.slice(3).every((cell) => cell === 'waiting')).toBe(true);
  });

  it("counts a round's recorded score, right ones first, once its answers aren't all at hand", () => {
    const round = makeRound(2, { status: 'diagnosing', train: { pass: 8, total: 12 } });
    const attempts = [makeAttempt('att_1', { round: 2, check: { pass: false, reason: 'No.' } })];
    expect(practiceCells(live({}, { attempts }), round)).toEqual([
      ...Array(8).fill('pass'),
      ...Array(4).fill('fail'),
    ]);
  });

  it('has none for a round that practiced nothing', () => {
    expect(practiceCells(live({}), attempting)).toEqual([]);
  });

  it('reads out how many are right, and how many are left', () => {
    const attempts = [makeAttempt('att_1', { round: 2, check: { pass: true, reason: 'Yes.' } })];
    const html = panel(live({ status: 'running', phase: 'attempting' }, { attempts }), attempting);
    expect(html).toContain('aria-label="1 of 1 right, 11 to go"');
  });
});
