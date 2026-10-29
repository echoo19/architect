import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CurrentRound } from '../../../src/renderer/src/flow/train/CurrentRound';
import type { LiveRun } from '../../../src/renderer/src/flow/train/run-state';
import { makeJob, makeRun } from './factories';

const NAMES = { mentor: 'Spark', student: 'Glimmer' };

function live(overrides: Partial<LiveRun['run']>): LiveRun {
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
  };
}

function panel(run: LiveRun): string {
  return renderToStaticMarkup(
    createElement(CurrentRound, {
      live: run,
      round: null,
      names: NAMES,
      experiment: undefined,
      question: null,
      recordsFailed: false,
    }),
  );
}

describe('a run that needed no rounds', () => {
  it('says the student met the target before any teaching, with its real score', () => {
    const html = panel(
      live({
        status: 'finished',
        phase: 'done',
        stopReason: 'target_met',
        devBaseline: { pass: 22, total: 23 },
      }),
    );
    expect(html).toContain('No teaching needed');
    expect(html).toContain('Got 22 of 23 check tasks right before any teaching');
    expect(html).toContain('Had nothing to change: Glimmer already met the target.');
    expect(html).not.toContain('Waiting for the first round');
  });

  it('still waits for the first round while a run is under way', () => {
    const html = panel(live({ status: 'running', phase: 'training', devBaseline: null }));
    expect(html).toContain('Before the first round');
    expect(html).not.toContain('No teaching needed');
  });
});
