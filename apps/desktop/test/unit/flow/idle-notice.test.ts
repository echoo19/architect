import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyTotals, type Job, type Run, type StudentTarget } from '@architect/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  askForAdvanced,
  takeAdvanced,
} from '../../../src/renderer/src/flow/define/advanced-request';
import { IdleNoticeView } from '../../../src/renderer/src/flow/train/IdleNotice';
import { hadStarted, idleView, type IdleFacts } from '../../../src/renderer/src/flow/train/idle';
import type { LiveRun } from '../../../src/renderer/src/flow/train/run-state';
import { makeJob, makeRound, makeRun } from './factories';

/** The sentence the engine keeps on the run, in its own words. */
const ENGINE =
  "The mentor has nothing it may change in this run. Instructions and steps, What it reads when and Small tools are turned off for this job in the teacher's settings. Its weights: Only the stand-in backend is set up here, and it trains nothing. Add a Hugging Face token to train an adapter. Change what it may change in the job's advanced settings, under Teacher, or set up what is missing, then start a new run.";

/** Only retraining the student is left on. */
const WEIGHTS_ONLY: Partial<Job> = { interventions: ['weights'] };
const FUNDED = { ...makeJob().budget, maxComputeUsd: 5 };

function live(
  job: Partial<Job> = WEIGHTS_ONLY,
  run: Partial<Run> = {},
  rest: Partial<LiveRun> = {},
): LiveRun {
  return {
    run: makeRun({
      status: 'stopped',
      phase: 'done',
      stopReason: 'nothing_to_try',
      error: ENGINE,
      ...run,
    }),
    job: makeJob(job),
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
    ...rest,
  };
}

const NO_KEY: IdleFacts = { token: 'none', keyAdded: false };
const HAS_KEY: IdleFacts = { token: 'found', keyAdded: false };

/** What a person must never meet on this notice: the engine's words for its own parts. */
const ENGINE_WORDS = /mentor|stand-in|adapter|backend|token|weights/i;

describe('what a run that had nothing it may change says to the person', () => {
  it('says what is off and what is missing, and that nothing was spent', () => {
    const view = idleView(live(), NO_KEY);
    expect(view).toEqual({
      title: "Training didn't start",
      body: 'Every kind of change Spark may make is turned off for this job, except retraining Glimmer itself, which needs a Hugging Face key. A free Hugging Face account gives you one. Nothing was spent.',
      missingKey: true,
      turnOn: true,
    });
  });

  it('says where the key comes from once, and only while the key is what is missing', () => {
    const once = (body: string) => body.match(/A free Hugging Face account gives you one\./g);
    expect(once(idleView(live(), NO_KEY).body)).toHaveLength(1);
    // Not for a budget the job lacks, a final test online, a key that is saved or a run begun.
    expect(once(idleView(live(), HAS_KEY).body)).toBeNull();
    expect(
      once(idleView(live(WEIGHTS_ONLY, {}, { lockedTestOn: 'hosted' }), NO_KEY).body),
    ).toBeNull();
    expect(
      once(
        idleView(live({ ...WEIGHTS_ONLY, budget: FUNDED }), { token: 'found', keyAdded: true })
          .body,
      ),
    ).toBeNull();
    expect(once(idleView(live(), NO_KEY).title)).toBeNull();
    // A run that had begun names the key the same way.
    const begun = live(WEIGHTS_ONLY, {}, { rounds: [makeRound(1, { decision: 'reverted' })] });
    expect(once(idleView(begun, NO_KEY).body)).toHaveLength(1);
  });

  it('is mended by turning a change back on, except where one is on already', () => {
    // Everything but the weights is off: the way out is to turn one back on.
    for (const [run, facts] of [
      [live(), NO_KEY],
      [live(), HAS_KEY],
      [live({ ...WEIGHTS_ONLY, budget: FUNDED }), HAS_KEY],
      [live({ ...WEIGHTS_ONLY, budget: FUNDED }), { token: 'found', keyAdded: true }],
      [live(WEIGHTS_ONLY, { method: 'self_reflection' }), NO_KEY],
    ] as [LiveRun, IdleFacts][]) {
      expect(idleView(run, facts).turnOn).toBe(true);
    }
    // A kind that changes the harness is on already: there is nothing to turn back on, and the
    // reason is in the engine's sentence.
    expect(idleView(live({ interventions: ['procedure', 'weights'] }), NO_KEY).turnOn).toBe(false);
    expect(
      idleView(live({ interventions: ['procedure'] }, { method: 'one_shot' }), NO_KEY).turnOn,
    ).toBe(false);
  });

  it('names whatever else keeps the retraining from running, as the Define screen does', () => {
    // No budget for training, the key being there.
    expect(idleView(live(), HAS_KEY).body).toContain(
      'except retraining Glimmer itself, which needs a training budget, and this job has none.',
    );
    expect(idleView(live(), HAS_KEY).missingKey).toBe(false);
    // The final test online, whatever the key and the budget.
    expect(
      idleView(live({ ...WEIGHTS_ONLY, budget: FUNDED }, {}, { lockedTestOn: 'hosted' }), HAS_KEY)
        .body,
    ).toContain("which can't be done while the final test runs online.");
    // The order is the engine's: the final test first, then the key, then the budget.
    expect(idleView(live(WEIGHTS_ONLY, {}, { lockedTestOn: 'hosted' }), NO_KEY).missingKey).toBe(
      false,
    );
  });

  it('claims nothing about the key before it has been read, or about a cause it cannot see', () => {
    const funded = live({ ...WEIGHTS_ONLY, budget: FUNDED });
    const unread = idleView(funded, { token: 'unknown', keyAdded: false });
    expect(unread.body).toContain("which couldn't run here.");
    expect(unread.missingKey).toBe(false);
    expect(idleView(funded, HAS_KEY).body).toContain("which couldn't run here.");
  });

  it('says the key is saved once the person added it from the notice', () => {
    const funded = live({ ...WEIGHTS_ONLY, budget: FUNDED });
    const view = idleView(funded, { token: 'found', keyAdded: true });
    expect(view.body).toBe(
      'Every kind of change Spark may make is turned off for this job, except retraining Glimmer itself, which needed a Hugging Face key. The key is saved now, so start again from the job. Nothing was spent.',
    );
    expect(view.missingKey).toBe(false);
    // Only for the cause it was added for: a budget the job lacks is still said.
    expect(idleView(live(), { token: 'found', keyAdded: true }).body).toContain(
      'needs a training budget',
    );
  });

  it('says "stopped", and not that nothing was spent, for a run that had begun', () => {
    const begun = live(WEIGHTS_ONLY, {}, { rounds: [makeRound(1, { decision: 'reverted' })] });
    const view = idleView(begun, NO_KEY);
    expect(view.title).toBe('Training stopped');
    expect(view.body).not.toContain('Nothing was spent');
    expect(view.body).toContain('which needs a Hugging Face key.');
    expect(
      idleView(live(WEIGHTS_ONLY, { totals: { ...emptyTotals(), attempts: 40 } }), NO_KEY).title,
    ).toBe('Training stopped');
    expect(hadStarted(live())).toBe(false);
    expect(hadStarted(begun)).toBe(true);
    expect(
      idleView(live({ ...WEIGHTS_ONLY, budget: FUNDED }, {}, { rounds: [makeRound(1)] }), HAS_KEY)
        .body,
    ).toContain("which couldn't go on.");
  });

  it('does not say nothing was spent when the run spent something', () => {
    const spent = live(WEIGHTS_ONLY, { totals: { ...emptyTotals(), mentorUsd: 0.2 } });
    expect(idleView(spent, NO_KEY).body).not.toContain('Nothing was spent');
  });

  it("leaves it to Details when a harness change is on, so the person's choice isn't why", () => {
    const odd = idleView(live({ interventions: ['procedure', 'weights'] }), NO_KEY);
    expect(odd.body).toBe(
      'Spark had nothing it may change in this run. The reason is under Details. Nothing was spent.',
    );
    expect(odd.missingKey).toBe(false);
    expect(odd.turnOn).toBe(false);
  });

  it('speaks of the simpler versions of a comparison as they are, with no weights in them', () => {
    const simpler = live(WEIGHTS_ONLY, { method: 'self_reflection' });
    expect(idleView(simpler, NO_KEY)).toMatchObject({
      body: expect.stringContaining('This simpler version can only change instructions'),
      missingKey: false,
    });
  });

  it('names the teacher and the student by their short names, whoever they are', () => {
    const named = makeJob(WEIGHTS_ONLY);
    const view = idleView(
      live({
        ...WEIGHTS_ONLY,
        mentor: { ...named.mentor, label: 'Muse Spark Open on Baseten' },
        student: { ...named.student, label: 'Muse Glimmer on this computer' },
      }),
      NO_KEY,
    );
    expect(view.body).toContain('Every kind of change Spark Open may make');
    expect(view.body).toContain('retraining Glimmer itself');
  });

  it("never says the engine's words, and never repeats its sentence", () => {
    const cases: [LiveRun, IdleFacts][] = [
      [live(), NO_KEY],
      [live(), HAS_KEY],
      [live(WEIGHTS_ONLY, {}, { lockedTestOn: 'hosted' as StudentTarget }), NO_KEY],
      [live({ ...WEIGHTS_ONLY, budget: FUNDED }), HAS_KEY],
      [live({ ...WEIGHTS_ONLY, budget: FUNDED }), { token: 'found', keyAdded: true }],
      [live({ interventions: ['procedure', 'weights'] }), NO_KEY],
      [live(WEIGHTS_ONLY, { method: 'one_shot' }), NO_KEY],
    ];
    for (const [run, facts] of cases) {
      const { title, body } = idleView(run, facts);
      expect(`${title} ${body}`).not.toMatch(ENGINE_WORDS);
      expect(body).not.toContain(ENGINE);
    }
  });
});

describe('the notice as it is shown', () => {
  const noop = () => undefined;
  /** The notice for a run that ended with the engine's sentence, or with none when `reason` is null. */
  const html = (view = idleView(live(), NO_KEY), reason: string | null = ENGINE) =>
    renderToStaticMarkup(
      createElement(IdleNoticeView, {
        view,
        teacher: 'Spark',
        reason: reason ?? undefined,
        onOpenTeacher: noop,
        onAddKey: noop,
      }),
    );

  it('is a status headed by what happened, with the two things the person can do', () => {
    const markup = html();
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Training didn&#x27;t start"');
    expect(markup).toContain('Training didn&#x27;t start');
    expect(markup).toContain(
      'which needs a Hugging Face key. A free Hugging Face account gives you one. Nothing was spent.',
    );
    expect(markup).toContain('Add the Hugging Face key');
    expect(markup.match(/<button/g)).toHaveLength(3);
  });

  it('names what the first button does, which is to turn a change back on', () => {
    const markup = html();
    expect(markup).toContain('Turn a change back on');
    // It is an action, not a place: it still opens the teacher's tab, and says so nowhere.
    expect(markup).not.toContain('Open Spark&#x27;s settings');
    expect(markup).toMatch(/<svg[^>]*lucide-toggle-right[^>]*aria-hidden="true"/);
  });

  it('keeps the name of the place where there is no change to turn on', () => {
    const odd = html(idleView(live({ interventions: ['procedure', 'weights'] }), NO_KEY));
    expect(odd).toContain('Open Spark&#x27;s settings');
    expect(odd).not.toContain('Turn a change back on');
  });

  it('offers the key only while the key is what is missing', () => {
    const markup = html(idleView(live(), HAS_KEY));
    expect(markup).toContain('Turn a change back on');
    expect(markup).not.toContain('Add the Hugging Face key');
  });

  it("keeps the engine's sentence folded under Details, and shows none of it until asked", () => {
    const markup = html();
    expect(markup).toMatch(/aria-expanded="false"[^>]*>[\s\S]*Details/);
    const words = markup.replace(/<[^>]*>/g, ' ');
    expect(words).not.toContain('stand-in');
    expect(words).not.toMatch(/mentor/i);
    // A run kept from before the sentence existed has nothing to put there.
    expect(html(idleView(live(), NO_KEY), null)).not.toContain('Details');
  });
});

describe("a way into the job's settings from another screen", () => {
  beforeEach(() => {
    // Whatever an earlier test asked for and nobody took.
    takeAdvanced('job_desk');
    takeAdvanced('job_other');
  });

  it('is answered once, by the job it was asked for', () => {
    askForAdvanced('job_desk', 'mentor');
    expect(takeAdvanced('job_other')).toBeNull();
    expect(takeAdvanced('job_desk')).toBe('mentor');
    expect(takeAdvanced('job_desk')).toBeNull();
  });

  it('keeps only the latest ask', () => {
    askForAdvanced('job_desk', 'budget');
    askForAdvanced('job_desk', 'mentor');
    expect(takeAdvanced('job_desk')).toBe('mentor');
  });

  it('is empty when nobody asked', () => {
    expect(takeAdvanced('job_desk')).toBeNull();
  });
});
