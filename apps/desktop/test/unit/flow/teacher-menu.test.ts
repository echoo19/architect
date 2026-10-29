import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobSchema, type InterventionType, type Job } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  advancedTabs,
  tabLabel,
  tabWithIssue,
} from '../../../src/renderer/src/flow/define/AdvancedDialog';
import { TeacherMenu } from '../../../src/renderer/src/flow/define/TeacherMenu';
import {
  agentChanges,
  idleBlock,
  isLastChange,
  keyHint,
  tokenState,
  weightsBlock,
  withIntervention,
  type WeightsFacts,
} from '../../../src/renderer/src/flow/define/teacher-menu';
import { validateJob } from '../../../src/renderer/src/flow/define/validate';
import { kindLabel } from '../../../src/renderer/src/flow/names';
import { makeJob } from './factories';

/** Everything the app can see says weights could be trained. */
const READY: WeightsFacts = { token: 'found', testPlace: 'local' };
const FUNDED = { ...makeJob().budget, maxComputeUsd: 5 };

function menu(job: Job, facts: WeightsFacts = READY, onAddKey?: () => void): string {
  return renderToStaticMarkup(
    createElement(TeacherMenu, { job, facts, onToggle: () => undefined, onAddKey }),
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
      'What it reads, and when',
      'Small tools',
      'Retrain Glimmer itself',
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
    // It names the teacher and the student, as every other line of the screen does.
    expect(html).toContain('Stays on: Spark needs at least one way to change Glimmer.');
    expect(html).not.toContain('the only way left');
    // Questions can always be turned off, since they change nothing.
    expect(row(html, 'Questions for you')).not.toContain('disabled=""');
    // Nothing else is held.
    expect(row(html, 'Instructions and steps')).not.toContain('disabled=""');
  });

  it('says on the weights row what the app knows keeps them from being trained here', () => {
    const job = makeJob();
    expect(menu(job, { token: 'none', testPlace: 'local' })).toContain('Needs a Hugging Face key');
    expect(menu(job, READY)).toContain('This job has no budget for training');
    expect(menu(makeJob({ budget: FUNDED }), { token: 'found', testPlace: 'hosted' })).toContain(
      'Can&#x27;t run while the final test is online',
    );
    // Nothing to say once it can: the row says what weights are.
    const fine = menu(makeJob({ budget: FUNDED }));
    expect(fine).toContain('Trains the model on checked corrections');
    expect(fine).not.toContain('Needs a Hugging Face key');
    // A kind that is off needs none of it.
    const off = menu(makeJob({ interventions: ['procedure'] }), {
      token: 'none',
      testPlace: 'local',
    });
    expect(off).not.toContain('Needs a Hugging Face key');
    expect(off).toContain('Trains the model on checked corrections');
  });

  it('says both when the only way left is the weights and they cannot be trained', () => {
    const html = menu(makeJob({ interventions: ['weights'] }), {
      token: 'none',
      testPlace: 'local',
    });
    const held = row(html, 'Retrain Glimmer itself');
    expect(held).toContain('disabled=""');
    expect(held).toContain('aria-checked="true"');
    // A switch held on reads as on, with a padlock, not as one that is off.
    expect(held).toContain('lucide-lock');
    expect(html).toContain(
      'Stays on: Spark needs at least one way to change Glimmer. Retraining Glimmer itself needs a Hugging Face key. A free Hugging Face account gives you one.',
    );
  });

  it('says where the key comes from once, on the row that names it as missing, and only then', () => {
    const none: WeightsFacts = { token: 'none', testPlace: 'local' };
    const once = (html: string) => html.match(/A free Hugging Face account gives you one\./g);
    // On the weights row while the key is missing: one mention.
    expect(menu(makeJob({ budget: FUNDED }), none)).toContain(
      'Needs a Hugging Face key. A free Hugging Face account gives you one.',
    );
    expect(once(menu(makeJob({ budget: FUNDED }), none))).toHaveLength(1);
    // On the held row too, in the sentence that names the key, and not twice.
    expect(once(menu(makeJob({ interventions: ['weights'] }), none))).toHaveLength(1);
    // Nowhere when the key is not what is missing, or when nothing is missing.
    for (const html of [
      menu(makeJob({ budget: FUNDED }), READY),
      menu(makeJob(), { token: 'found', testPlace: 'local' }),
      menu(makeJob({ budget: FUNDED }), { token: 'found', testPlace: 'hosted' }),
      menu(makeJob({ interventions: ['procedure'] }), none),
    ]) {
      expect(once(html)).toBeNull();
    }
    expect(keyHint('no_token')).toBe(' A free Hugging Face account gives you one.');
    expect(keyHint('no_budget')).toBe('');
    expect(keyHint('online_test')).toBe('');
  });

  it('puts the way to add the key on the weights row while the key is what is missing', () => {
    const none: WeightsFacts = { token: 'none', testPlace: 'local' };
    const add = () => undefined;
    const html = menu(makeJob({ budget: FUNDED }), none, add);
    // One button, between the weights row's name and the next row's.
    const between = html.slice(
      html.indexOf('>Retrain Glimmer itself<'),
      html.indexOf('>Questions for you<'),
    );
    expect(between).toContain('>Add the key</button>');
    expect(html.match(/>Add the key</g)).toHaveLength(1);
    // It is there too when the weights are the only way left, which is when it matters most.
    expect(
      menu(makeJob({ interventions: ['weights'] }), none, add).match(/>Add the key</g),
    ).toHaveLength(1);
    // Nothing to add once the key is found, when something else keeps the weights from running,
    // when they are turned off, or when nothing can take the person there.
    expect(menu(makeJob({ budget: FUNDED }), READY, add)).not.toContain('Add the key');
    expect(menu(makeJob(), { token: 'found', testPlace: 'local' }, add)).not.toContain(
      'Add the key',
    );
    expect(menu(makeJob({ interventions: ['procedure'] }), none, add)).not.toContain('Add the key');
    expect(menu(makeJob({ budget: FUNDED }), none)).not.toContain('Add the key');
  });

  it('never says token, where the person has to look for a key', () => {
    const html = menu(makeJob({ interventions: ['weights'] }), {
      token: 'none',
      testPlace: 'local',
    });
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/token/i);
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

describe('what each kind of change is called', () => {
  it('names the student in the kind that retrains it, and puts the other names in plain words', () => {
    expect(kindLabel('weights', 'Glimmer')).toBe('Retrain Glimmer itself');
    expect(kindLabel('weights', 'Glimmer Open')).toBe('Retrain Glimmer Open itself');
    expect(kindLabel('retrieval', 'Glimmer')).toBe('What it reads, and when');
    expect(kindLabel('procedure', 'Glimmer')).toBe('Instructions and steps');
    expect(kindLabel('helper', 'Glimmer')).toBe('Small tools');
    expect(kindLabel('clarification', 'Glimmer')).toBe('Questions for you');
  });
});

describe("the teacher's tab", () => {
  it('is named for the teacher, wherever the rail lists it, and wherever a line sends the person to it', () => {
    const named = (teacher: string) =>
      advancedTabs(teacher).find((tab) => tab.value === 'mentor')?.label;
    expect(named('Spark')).toBe('Spark');
    expect(named('Spark Open')).toBe('Spark Open');
    expect(tabLabel('mentor', 'Spark')).toBe('Spark');
    // The other tabs keep their names, in the same order, whoever teaches.
    expect(advancedTabs('Spark').map((tab) => tab.label)).toEqual([
      'Example tasks',
      'Ready when',
      'Time and budget',
      'Spark',
      "Agent's model",
      'Starting instructions',
      'Grading',
      'Task sets',
      'When a change stays',
    ]);
    expect(tabLabel('budget', 'Spark')).toBe('Time and budget');
  });
});

describe('a choice the engine would refuse', () => {
  it("is marked in the teacher's tab, which Start training opens", () => {
    const issues = validateJob({ ...makeJob(), interventions: ['clarification'] }, 170);
    expect(Object.keys(issues)).toEqual(['interventions']);
    expect(tabWithIssue(issues)).toBe('mentor');
  });
});
