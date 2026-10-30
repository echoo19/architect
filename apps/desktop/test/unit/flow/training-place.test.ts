import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job } from '@architect/shared';
import { TooltipProvider } from '@architect/ui';
import { describe, expect, it } from 'vitest';
import type { HostedAvailability } from '../../../src/renderer/src/flow/define/hosted';
import {
  aboutUsd,
  allowingLine,
  capText,
  estimateNotes,
  estimateTime,
  expectedMentorUsd,
  minutesForOneRound,
  trainHereLine,
} from '../../../src/renderer/src/flow/define/estimates';
import { TrainingPlace, TrainingRows } from '../../../src/renderer/src/flow/define/TrainingPlace';
import { makeJob } from './factories';

const COPY = {
  runtime: 'openai_compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'meta/muse-glimmer-30b',
  secretRef: 'openrouter',
  contextLength: 16_384,
} as const;

const READY: HostedAvailability = { available: true };
const NO_SERVICE: HostedAvailability = {
  available: false,
  why: 'no_host',
  reason: "Pick an online service under Agent's model in Advanced settings",
};
const NO_KEY: HostedAvailability = {
  available: false,
  why: 'no_key',
  reason: 'Add an OpenRouter key in Advanced settings',
};
const CHECKING: HostedAvailability = {
  available: false,
  why: 'checking',
  reason: 'Checking for a saved key',
};

/** A job with an online copy that trains where `trainOn` says, in `minutes` of training time. */
function jobOf(trainOn: 'local' | 'hosted', minutes = 180): Job {
  const base = makeJob({ budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: minutes } });
  return { ...base, student: { ...base.student, trainOn, hosted: COPY } };
}

const noop = () => undefined;

function render(job: Job, hosted: HostedAvailability = READY): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(TrainingPlace, {
        job,
        hosted,
        testPlace: 'local',
        onPlaceChange: noop,
        onRaiseLimit: noop,
        onAllowTime: noop,
        onSetUpOnline: noop,
      }),
    ),
  );
}

/** The figures under the choice: the estimate, the cap, and the comparison when it is offered. */
function renderRows(job: Job, withComparison = false): string {
  return renderToStaticMarkup(
    createElement(TrainingRows, {
      job,
      hosted: READY,
      testPlace: 'local',
      onCapChange: noop,
      baselines: withComparison ? { checked: false, onCheckedChange: noop } : undefined,
    }),
  );
}

/** What a person reads: no tags, the entities decoded, one space between words. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const TITLE = 'Not even one round of teaching fits in 3 hours on this computer';
const BODY =
  'Scoring the check tasks once takes about 1 h 40 min, then 3 h 50 min to 7 h 10 min for each round of teaching.';
/** What the button that sets a longer limit gives: the limit `minutesForOneRound` found. */
const GIVES = 'Allowing 9 hours leaves room for one round of teaching.';

/** The words of the callout alone, apart from the cards around it. */
function callout(html: string): string {
  const at = html.indexOf('role="status"');
  return text(html.slice(html.lastIndexOf('<div', at)));
}

describe('a place that cannot fit a round', () => {
  it('is one clear callout by the choice, saying in plain words that not one round fits', () => {
    const html = render(jobOf('local'));
    expect(html).toContain('role="status"');
    expect(text(html)).toContain(TITLE);
    expect(text(html)).toContain(BODY);
    // Both ways out are buttons on it: a limit sure to fit a round (1 h 40 min of check tasks and
    // a round of at most 7 h 10 min), and training online. The small link that was alone is gone.
    expect(html.match(/>Allow 9 hours</g)).toHaveLength(1);
    expect(html).not.toContain('Allow more time');
    expect(html).toContain('>Train online instead</button>');
    // It sits right under the choice, and nothing but the way out of it follows.
    expect(html.indexOf('Train online instead')).toBeGreaterThan(html.indexOf('Train on this'));
    expect(html.indexOf(TITLE)).toBeGreaterThan(html.indexOf('Only what Spark reads'));
  });

  it('does not leave the reader asking what is taught: it says rounds of teaching', () => {
    const words = text(render(jobOf('local')));
    expect(words).not.toContain("won't get to teach");
    expect(words).toContain('Not even one round of teaching');
  });

  it('keeps what the time button gives for when it is asked, in the limit that button sets', () => {
    const job = jobOf('local');
    const html = render(job);
    // The line is the button's tooltip, so the callout itself says no more than its figures.
    expect(callout(html)).not.toContain('leaves room');
    // It is the limit the button names, found once: the line and the label cannot differ.
    const minutes = minutesForOneRound(job, 'local') ?? 0;
    expect(minutes).toBe(540);
    expect(allowingLine(minutes)).toBe(GIVES);
    expect(html).toContain(`>Allow ${capText(minutes)}<`);
    // And it is true: a job allowed that long has room for a round, and no callout.
    expect(text(render(jobOf('local', minutes)))).not.toContain('Not even one round');
    expect(estimateTime(jobOf('local', minutes), 'local').rounds.fewest).toBeGreaterThanOrEqual(1);
    // It is the shortest whole number of hours that does: a round that is measured again needs
    // 8 h 50 min, and 8 hours does not give it.
    expect(estimateTime(jobOf('local', 529), 'local').rounds.fewest).toBe(0);
    expect(estimateTime(jobOf('local', minutes - 60), 'local').rounds.fewest).toBe(0);
  });

  it('says it in the unit the time is in, for a job that trains online', () => {
    const job = jobOf('hosted', 20);
    expect(render(job)).toContain('>Allow 1 hour<');
    expect(allowingLine(minutesForOneRound(job, 'hosted') ?? 0)).toBe(
      'Allowing 1 hour leaves room for one round of teaching.',
    );
  });

  it('is loud: a tinted box with an alert mark, not a pale line', () => {
    const html = render(jobOf('local'));
    expect(html).toMatch(/bg-danger-soft[^"]*"[^>]*>\s*<svg[^>]*lucide-circle-alert/);
  });

  it('offers training online only when it is possible, and says what it needs when not', () => {
    // No online service chosen: a button sets it up, which says all there is to say.
    const none = render(jobOf('local'), NO_SERVICE);
    expect(none).not.toContain('Train online instead');
    expect(callout(none)).not.toContain("Online training isn't");
    expect(callout(none)).not.toContain("Pick an online service under Agent's model");
    expect(none).toContain('Set up online training');
    // Its key isn't saved: the same, and the card says which key.
    const key = render(jobOf('local'), NO_KEY);
    expect(key).not.toContain('Train online instead');
    expect(callout(key)).not.toContain("Online training isn't");
    expect(callout(key)).not.toContain('Add an OpenRouter key');
    expect(text(key)).toContain('Add an OpenRouter key in Advanced settings');
    expect(key).toContain('Set up online training');
    // Still looking for the key: no button to set up, so the sentence says the rest itself.
    const looking = render(jobOf('local'), CHECKING);
    expect(callout(looking)).toContain("Online training isn't ready. Checking for a saved key.");
    expect(looking).not.toContain('Set up online training');
    expect(looking).not.toContain('Train online instead');
  });

  it('offers more time alone when training online would be too slow as well', () => {
    // 20 minutes: this computer can't score the check tasks, and online can't fit a round either.
    const html = render(jobOf('local', 20));
    expect(html).toContain('>Allow 9 hours</button>');
    expect(html).not.toContain('Train online instead');
    expect(text(html)).toContain(
      'Not even one round of teaching fits in 20 minutes on this computer',
    );
  });

  it("says online can't fit a round when online is where it trains, with nothing else to offer", () => {
    const html = render(jobOf('hosted', 20));
    expect(text(html)).toContain('Not even one round of teaching fits in 20 minutes online');
    expect(text(html)).toContain(
      'Scoring the check tasks once takes about 10 min, then 23 min to 43 min for each round of teaching.',
    );
    expect(html).toContain('>Allow 1 hour</button>');
    expect(html).not.toContain('instead');
  });

  it('opens the time limit instead when not even a week would fit a round, with nothing promised', () => {
    const base = jobOf('local');
    const html = render({ ...base, splits: { ...base.splits, dev: 2000 } });
    expect(html).toContain('>Allow more time</button>');
    expect(html).not.toMatch(/>Allow \d+ hours?</);
    expect(text(html)).not.toContain('leaves room for one round');
  });

  it('says nothing of the kind where a round fits, and keeps the quiet line for the other place', () => {
    // Training online fits; this computer, which is not chosen, doesn't.
    const html = render(jobOf('hosted'));
    expect(text(html)).not.toContain('Not even one round');
    expect(text(html)).toContain('Too slow for the 3-hour limit');
    expect(html.match(/>Allow more time</g)).toHaveLength(1);
    // And where both fit there is nothing to say about time at all.
    const roomy = render(jobOf('local', 2000));
    expect(text(roomy)).not.toContain('Not even one round');
    expect(roomy).not.toContain('Allow more time');
  });
});

describe('the card of the place that is chosen', () => {
  /** The markup of one card, from its radio button to its end. */
  function card(html: string, title: string): string {
    const at = html.indexOf(title);
    return html.slice(html.lastIndexOf('<button', at), html.indexOf('</button>', at));
  }

  it('does not say again that it is too slow, right above the callout that says so', () => {
    const html = render(jobOf('local'));
    expect(card(html, 'Train on this computer')).not.toContain('Too slow');
    expect(callout(html)).toContain('Not even one round');
    // Online is not chosen and fits: it says nothing of the kind either.
    expect(card(html, 'Train online')).not.toContain('Too slow');
  });

  it('keeps the line on a card that is not chosen', () => {
    const online = render(jobOf('hosted'));
    expect(card(online, 'Train on this computer')).toContain('Too slow for the 3-hour limit');
    // Online chosen and too slow: its callout says so, and this computer, not chosen, still does.
    const both = render(jobOf('hosted', 20));
    expect(card(both, 'Train on this computer')).toContain('Too slow for the 20-minute limit');
    expect(card(both, 'Train online')).not.toContain('Too slow');
  });

  it('keeps its title in the normal color, so it does not look switched off', () => {
    const html = render(jobOf('local'));
    const chosen = card(html, 'Train on this computer');
    expect(chosen).toContain('data-state="checked"');
    // The quiet title is for a card that is not chosen; a chosen one keeps the color of its text.
    expect(chosen).toContain('group-data-[state=unchecked]:text-fg-dim');
    expect(chosen).not.toMatch(/(?:^|[\s"])text-fg-dim/);
  });

  it('says how fast the place practices and what that costs, in a line each', () => {
    const html = render(jobOf('hosted'));
    expect(text(card(html, 'Train on this computer'))).toMatch(/About 2\.5 minutes a task Free/);
    expect(text(card(html, 'Train online'))).toMatch(/About 15 seconds a task About \$\d+(\.\d+)?/);
  });
});

describe('what leaves this computer when training here', () => {
  const names = { mentor: 'Spark', student: 'Glimmer' };
  /** The note under the choice, which is about the place chosen. */
  const note = (job: Job) => text(render(job));
  const withTeacher = (mentor: Job['mentor']): Job => ({ ...jobOf('local', 2000), mentor });
  const ollama = {
    kind: 'model',
    provider: 'ollama',
    label: 'Muse Spark Open on this computer',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'spark-open',
    reasoningEffort: 'medium',
  } as const;

  it('says nothing leaves it only when the teacher runs here too', () => {
    // Training always sends the teacher its view of the practice attempts, so this is the one
    // case in which the claim is true.
    expect(note(withTeacher(ollama))).toContain('Nothing leaves this computer.');
    for (const baseUrl of ['http://localhost:1234/v1', 'http://[::1]:11434/v1']) {
      expect(note(withTeacher({ ...ollama, baseUrl }))).toContain('Nothing leaves this computer.');
    }
  });

  it('says what goes online when the teacher is online, which is what it reads to teach', () => {
    // The default teacher is Meta's online API.
    const words = note(jobOf('local', 2000));
    expect(words).toContain('Only what Spark reads to teach goes online.');
    expect(words).not.toContain('Nothing leaves');
  });

  it('counts a coding agent as online, and a local runtime at another machine as online', () => {
    const agent = withTeacher({ kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' });
    expect(note(agent)).toContain('Only what Claude Code reads to teach goes online.');
    // A runtime that is local by kind, pointed at another machine's address, is not this computer.
    const lan = withTeacher({ ...ollama, baseUrl: 'http://192.168.1.20:11434/v1' });
    expect(note(lan)).toContain('Only what');
    expect(note(lan)).not.toContain('Nothing leaves');
  });

  it('says the tasks and files go online when training happens online', () => {
    const words = note(jobOf('hosted'));
    expect(words).toContain('Tasks and files go online.');
    expect(words).not.toContain('Only what Spark reads');
  });

  it('says the same on a Mac, where the choice is named for it', () => {
    expect(trainHereLine(jobOf('local'), names, 'this Mac')).toBe(
      'Only what Spark reads to teach goes online.',
    );
    expect(trainHereLine(withTeacher(ollama), names, 'this Mac')).toBe('Nothing leaves this Mac.');
  });

  it("says where the teacher works in the estimate's notes, and says it as the note does", () => {
    const notes = (job: Job) =>
      estimateNotes(job, {
        names,
        device: { inSentence: 'this computer', label: 'This computer' },
        local: estimateTime(job, 'local'),
        remote: estimateTime(job, 'hosted'),
        baselines: false,
      }).join(' ');
    expect(notes(jobOf('local', 2000))).toContain(
      'Spark works in the cloud and sees the practice attempts',
    );
    const words = notes(withTeacher(ollama));
    expect(words).toContain('Spark runs on this computer and sees the practice attempts');
    expect(words).not.toContain('works in the cloud');
  });
});

describe('what the estimate assumes', () => {
  const names = { mentor: 'Spark', student: 'Glimmer' };
  const input = (job: Job, extra: { remote?: boolean; baselines?: boolean } = {}) => ({
    names,
    device: { inSentence: 'this computer', label: 'This computer' },
    local: estimateTime(job, 'local'),
    remote: extra.remote === false ? null : estimateTime(job, 'hosted'),
    baselines: extra.baselines === true,
  });

  it('says when training stops, how many rounds fit at each place, and what has a hard cap', () => {
    const job = jobOf('local');
    const notes = estimateNotes(job, input(job));
    expect(notes[0]).toBe(
      "Training stops at the 90% target, after 12 rounds or after 3 hours, or sooner once changes stop helping. Paused time doesn't count.",
    );
    expect(notes.some((line) => line.startsWith('This computer: '))).toBe(true);
    expect(notes.some((line) => line.startsWith('Online: '))).toBe(true);
    expect(notes.at(-1)).toBe("Only Spark's bill has a hard cap.");
  });

  it('leaves out the online place when there is no copy to train on, and the simpler versions unless offered', () => {
    const job = jobOf('local');
    const notes = estimateNotes(job, input(job, { remote: false })).join(' ');
    expect(notes).not.toContain('Online:');
    expect(notes).not.toContain('simpler versions');
    const compared = estimateNotes(job, input(job, { baselines: true })).join(' ');
    expect(compared).toContain(
      'The three simpler versions are Glimmer on its own, a setup Spark writes in one go, and Glimmer revising its own. They run after this agent.',
    );
  });
});

describe('the rows of the plan', () => {
  it('says what it all takes and costs as two figures, with the lines behind a fold', () => {
    const html = renderRows(jobOf('hosted'));
    expect(html).toContain('aria-label="Estimate"');
    // The time is a figure; the cost is one a screen reader hears whole, and a button opens the rest.
    expect(text(html)).toMatch(/Estimate\s*[\d.]+ h/);
    expect(html).toMatch(/role="img" aria-label="\$\d+(?:\.\d{2})?"/);
    expect(html).toMatch(/aria-expanded="false"[^>]*>[\s\S]*?Breakdown/);
    expect(text(html)).not.toContain('Final test');
  });

  it("says the teacher's cap and what is expected of it, in the teacher's name", () => {
    const job = jobOf('hosted');
    const html = renderRows(job);
    expect(text(html)).toContain('Spark spending cap');
    const expected = expectedMentorUsd(job, estimateTime(job, 'hosted')) ?? 0;
    expect(text(html)).toContain(`${aboutUsd(expected)} expected`);
    expect(html).toContain('aria-valuetext="$5"');
  });

  it('offers the comparison only when comparison mode is on, and says what it adds', () => {
    expect(text(renderRows(jobOf('hosted')))).not.toMatch(/comparison|simpler versions/i);
    const html = renderRows(jobOf('hosted'), true);
    expect(text(html)).toContain('Also train three simpler versions to compare');
    expect(text(html)).toMatch(
      /Adds [\d.]+ h · \$[\d.]+ Online practice · \$[\d.]+ Spark teaching/,
    );
  });
});

describe('the online place', () => {
  it('says how fast it is and what it costs where a service is chosen, even before its key is saved', () => {
    for (const hosted of [READY, NO_KEY]) {
      const words = text(render(jobOf('hosted'), hosted));
      expect(words).toMatch(/About 15 seconds a task/);
      expect(words).toMatch(/About \$\d+(\.\d+)?/);
      expect(words).toContain('Tasks and files go online.');
    }
    expect(text(render(jobOf('hosted'), NO_KEY))).toContain(
      'Add an OpenRouter key in Advanced settings',
    );
  });

  it('asks for a service in plain words before one is chosen', () => {
    const base = makeJob();
    const { hosted: _none, ...student } = jobOf('local').student;
    const words = text(render({ ...base, student: { ...student, trainOn: 'local' } }, NO_SERVICE));
    expect(words).toContain("Pick an online service under Agent's model in Advanced settings");
    expect(words).not.toMatch(/\bhost\b/i);
  });
});
