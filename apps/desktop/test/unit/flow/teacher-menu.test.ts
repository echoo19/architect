import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobSchema, type InterventionType, type Job } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { tabWithIssue } from '../../../src/renderer/src/flow/define/AdvancedDialog';
import { TeacherMenu } from '../../../src/renderer/src/flow/define/TeacherMenu';
import {
  agentChanges,
  idleBlock,
  isLastChange,
  tokenState,
  weightsBlock,
  withIntervention,
  type WeightsFacts,
} from '../../../src/renderer/src/flow/define/teacher-menu';
import { validateJob } from '../../../src/renderer/src/flow/define/validate';
import { makeJob } from './factories';

/** Everything the app can see says weights could be trained. */
const READY: WeightsFacts = { token: 'found', testPlace: 'local' };
const FUNDED = { ...makeJob().budget, maxComputeUsd: 5 };

function menu(job: Job, facts: WeightsFacts = READY): string {
  return renderToStaticMarkup(
    createElement(TeacherMenu, { job, facts, onToggle: () => undefined }),
  );
}

/** The markup of one row: from its label to the end of its switch. */
function row(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, `a row named ${label}`).toBeGreaterThan(-1);
  const end = html.indexOf('</button>', at);
  return html.slice(at, end);
}

describe('choosing what the teacher may change', () => {
  it('turns a kind off and back on, and holds no list for a job that allows everything', () => {
    const job = makeJob();
    expect(job.interventions).toBeUndefined();

    const noTools = withIntervention(job, 'helper', false);
    expect(noTools.interventions).toEqual(['procedure', 'retrieval', 'weights', 'clarification']);
    const noQuestions = withIntervention(noTools, 'clarification', false);
    expect(noQuestions.interventions).toEqual(['procedure', 'retrieval', 'weights']);

    // Back to all five: the job is as it was, without the key.
    const back = withIntervention(
      withIntervention(noQuestions, 'helper', true),
      'clarification',
      true,
    );
    expect('interventions' in back).toBe(false);
    expect(back).toEqual(job);
    // And what it saves is a job the engine accepts.
    expect(JobSchema.safeParse(noQuestions).success).toBe(true);
  });

  it("keeps the list in the menu's order whichever way the person turned things", () => {
    let job = makeJob();
    for (const type of ['weights', 'procedure', 'retrieval'] as const) {
      job = withIntervention(job, type, false);
    }
    for (const type of ['retrieval', 'weights'] as const) job = withIntervention(job, type, true);
    expect(job.interventions).toEqual(['retrieval', 'helper', 'weights', 'clarification']);
  });

  it('knows the one kind left that changes the agent, which stays on', () => {
    const all = makeJob();
    expect(agentChanges(all)).toEqual(['procedure', 'retrieval', 'helper', 'weights']);
    expect(
      ['procedure', 'retrieval', 'helper', 'weights', 'clarification'].some((type) =>
        isLastChange(all, type as InterventionType),
      ),
    ).toBe(false);

    const one = makeJob({ interventions: ['helper', 'clarification'] });
    expect(isLastChange(one, 'helper')).toBe(true);
    expect(isLastChange(one, 'clarification')).toBe(false);
    expect(isLastChange(one, 'procedure')).toBe(false);
  });
});

describe('what keeps weights from being trained here, as far as the app can tell', () => {
  const job = makeJob({ budget: FUNDED });

  it('names nothing when everything it can see is in place', () => {
    expect(weightsBlock(job, READY)).toBeNull();
  });

  it('names the first thing the engine would stop at', () => {
    const noBudget = makeJob();
    expect(weightsBlock(noBudget, READY)).toBe('no_budget');
    expect(weightsBlock(noBudget, { token: 'none', testPlace: 'local' })).toBe('no_token');
    expect(weightsBlock(noBudget, { token: 'none', testPlace: 'hosted' })).toBe('online_test');
  });

  it('says nothing about a token it has not read yet', () => {
    expect(weightsBlock(job, { token: 'unknown', testPlace: 'local' })).toBeNull();
    expect(
      tokenState({ status: 'loading', data: undefined, error: undefined, reload: () => {} }),
    ).toBe('unknown');
    const read = (source: 'saved' | null) =>
      tokenState({ status: 'success', data: { source }, error: undefined, reload: () => {} });
    expect(read('saved')).toBe('found');
    expect(read(null)).toBe('none');
  });

  it('is an idle teacher only when no change to the harness is on', () => {
    const none: WeightsFacts = { token: 'none', testPlace: 'local' };
    expect(idleBlock(makeJob({ interventions: ['weights'] }), none)).toBe('no_token');
    expect(idleBlock(makeJob({ interventions: ['weights', 'helper'] }), none)).toBeNull();
    expect(idleBlock(makeJob({ interventions: ['weights'], budget: FUNDED }), READY)).toBeNull();
  });
});

describe("the Teacher tab's section", () => {
  it('names the teacher and gives each kind of change an icon, a name and a switch', () => {
    const html = menu(makeJob({ budget: FUNDED }));
    expect(html).toContain('What Spark may change');
    for (const label of [
      'Instructions and steps',
      'What it reads when',
      'Small tools',
      'Its weights',
      'Questions for you',
    ]) {
      const one = row(html, label);
      expect(one).toContain('role="switch"');
      expect(one).toContain(`aria-label="${label}"`);
      expect(one).toContain('aria-checked="true"');
      expect(one).not.toContain('disabled=""');
    }
    // An icon each, drawn by the design's icon set and hidden from a screen reader.
    expect(html.match(/<svg[^>]*lucide[^>]*aria-hidden="true"/g)).toHaveLength(5);
    expect(html).toContain('Rules and step-by-step procedures it follows');
    expect(html).toContain('Spark may stop and ask you one question');
  });

  it('shows a kind the person turned off as off', () => {
    const html = menu(makeJob({ interventions: ['procedure', 'retrieval', 'weights'] }));
    expect(row(html, 'Small tools')).toContain('aria-checked="false"');
    expect(row(html, 'Questions for you')).toContain('aria-checked="false"');
    expect(row(html, 'Instructions and steps')).toContain('aria-checked="true"');
  });

  it('keeps the last kind that changes the agent on, and says why on its row', () => {
    const html = menu(makeJob({ interventions: ['helper', 'clarification'] }));
    const last = row(html, 'Small tools');
    expect(last).toContain('aria-checked="true"');
    expect(last).toContain('disabled=""');
    expect(html).toContain('Stays on: the only way left to change the agent');
    // Questions can always be turned off, since they change nothing.
    expect(row(html, 'Questions for you')).not.toContain('disabled=""');
    // Nothing else is held.
    expect(row(html, 'Instructions and steps')).not.toContain('disabled=""');
  });

  it('says on the weights row what the app knows keeps them from being trained here', () => {
    const job = makeJob();
    expect(menu(job, { token: 'none', testPlace: 'local' })).toContain(
      'Needs a Hugging Face token, added in Settings',
    );
    expect(menu(job, READY)).toContain('This job has no budget for training');
    expect(menu(makeJob({ budget: FUNDED }), { token: 'found', testPlace: 'hosted' })).toContain(
      'Can&#x27;t run while the final test is online',
    );
    // Nothing to say once it can: the row says what weights are.
    const fine = menu(makeJob({ budget: FUNDED }));
    expect(fine).toContain('Trains the model itself on checked corrections');
    expect(fine).not.toContain('Needs a Hugging Face token');
    // A kind that is off needs none of it.
    const off = menu(makeJob({ interventions: ['procedure'] }), {
      token: 'none',
      testPlace: 'local',
    });
    expect(off).not.toContain('Needs a Hugging Face token');
    expect(off).toContain('Trains the model itself on checked corrections');
  });

  it('says both when the only way left is the weights and they cannot be trained', () => {
    const html = menu(makeJob({ interventions: ['weights'] }), {
      token: 'none',
      testPlace: 'local',
    });
    expect(row(html, 'Its weights')).toContain('disabled=""');
    expect(html).toContain(
      'Stays on: the only way left to change the agent. Its weights need a Hugging Face token, added in Settings.',
    );
  });

  it('shows a problem with the saved choice where the person is looking', () => {
    const html = renderToStaticMarkup(
      createElement(TeacherMenu, {
        job: makeJob(),
        facts: READY,
        issue: 'Keep at least one way to change the agent.',
        onToggle: () => undefined,
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Keep at least one way to change the agent.');
  });
});

describe('a choice the engine would refuse', () => {
  it('is marked in the Teacher tab, which Start training opens', () => {
    const issues = validateJob({ ...makeJob(), interventions: ['clarification'] }, 170);
    expect(Object.keys(issues)).toEqual(['interventions']);
    expect(tabWithIssue(issues)).toBe('mentor');
  });
});
