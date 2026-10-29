import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdleNotice } from '../../../src/renderer/src/flow/train/IdleNotice';
import type { LiveRun } from '../../../src/renderer/src/flow/train/run-state';
import { makeJob, makeRun } from './factories';

function live(error?: string): LiveRun {
  return {
    run: makeRun({
      status: 'stopped',
      phase: 'done',
      stopReason: 'nothing_to_try',
      ...(error === undefined ? {} : { error }),
    }),
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

describe('the notice of a run whose teacher had nothing it may change', () => {
  it("names the teacher, gives the engine's reason and a way back to the job", () => {
    const html = renderToStaticMarkup(
      createElement(IdleNotice, {
        live: live(
          "The mentor has nothing it may change in this run. Small tools is turned off for this job in the teacher's settings.",
        ),
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Spark had nothing it may change');
    expect(html).toContain(
      'The mentor has nothing it may change in this run. Small tools is turned off for this job in the teacher&#x27;s settings.',
    );
    expect(html).toContain('Back to the job');
  });

  it('still says something when a run from before the sentence was kept has none', () => {
    const html = renderToStaticMarkup(createElement(IdleNotice, { live: live() }));
    expect(html).toContain('Every way to change the agent was off for this run.');
  });
});
