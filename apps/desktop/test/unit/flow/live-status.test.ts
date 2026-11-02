import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@architect/ui';
import { describe, expect, it } from 'vitest';
import { LiveStatus } from '../../../src/renderer/src/flow/train/LiveStatus';
import type { PhaseView, Stage } from '../../../src/renderer/src/flow/train/phase';
import type { EvalProgress } from '../../../src/renderer/src/flow/train/run-state';

function render(stage: Stage, progress: EvalProgress | null): string {
  const view: PhaseView = { stage, motion: 'checking', frozen: false, text: 'Scoring' };
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(LiveStatus, {
        mentor: 'Spark',
        student: 'Glimmer',
        studentPlace: 'online',
        hosted: true,
        status: 'running',
        view,
        drafting: false,
        inRound: true,
        passRate: null,
        progress,
        practice: null,
      }),
    ),
  );
}

/** The reading of the meter for one step, 0 to 100. */
function meter(html: string, name: string): number {
  const match = new RegExp(`role="meter" aria-label="${name}"[^>]*aria-valuenow="(\\d+)"`).exec(
    html,
  );
  return Number(match?.[1]);
}

describe('the steps of a round', () => {
  it('starts a counted step empty and fills it with its count', () => {
    expect(meter(render('evaluating', null), 'Score')).toBe(0);
    expect(meter(render('evaluating', { split: 'dev', done: 10, total: 40 }), 'Score')).toBe(25);
    expect(meter(render('evaluating', { split: 'dev', done: 40, total: 40 }), 'Score')).toBe(100);
    expect(meter(render('testing', null), 'Final test')).toBe(0);
  });

  it('keeps the steps before the one under way full', () => {
    const html = render('evaluating', null);
    expect(meter(html, 'Practice')).toBe(100);
    expect(meter(html, 'Diagnose')).toBe(100);
  });
});
