import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Job } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { HostedAvailability } from '../../../src/renderer/src/flow/define/hosted';
import { TrainingPlace } from '../../../src/renderer/src/flow/define/TrainingPlace';
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

function render(job: Job, hosted: HostedAvailability = READY): string {
  const noop = () => undefined;
  return renderToStaticMarkup(
    createElement(TrainingPlace, {
      job,
      hosted,
      testPlace: 'local',
      onPlaceChange: noop,
      onCapChange: noop,
      onRaiseLimit: noop,
      onSetUpOnline: noop,
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

const TITLE = "Training on this computer won't get to teach in 3 hours";
const BODY =
  "Glimmer takes about 2.5 minutes a task here: about 1 h 40 min to score the check tasks once, and at least 3 h 50 min more for each round of practice and fixing. That doesn't fit in the 3 hours allowed, so Spark would run out of time before it changed anything.";

describe('a place that cannot fit a round', () => {
  it('is one clear callout by the choice, saying in plain words that nothing would be taught', () => {
    const html = render(jobOf('local'));
    expect(html).toContain('role="status"');
    expect(text(html)).toContain(TITLE);
    expect(text(html)).toContain(BODY);
    // Both ways out are buttons on it, and the small link that used to be alone is gone.
    expect(html.match(/>Allow more time</g)).toHaveLength(1);
    expect(html).toContain('>Train online instead</button>');
    // It sits right under the choice, before the plan's figures.
    expect(html.indexOf('Train online instead')).toBeGreaterThan(html.indexOf('Train on this'));
    expect(html.indexOf('Train online instead')).toBeLessThan(html.indexOf('Estimated time'));
  });

  it('is loud: a tinted box with an alert mark, not a pale line', () => {
    const html = render(jobOf('local'));
    expect(html).toMatch(
      /border-danger-line bg-danger-tint[^"]*"[^>]*>\s*<svg[^>]*lucide-circle-alert/,
    );
  });

  it('offers training online only when it is possible, and says what it needs when not', () => {
    // No online service chosen: what it needs, and the way to set it up, but no switch to it.
    const none = render(jobOf('local'), NO_SERVICE);
    expect(none).not.toContain('Train online instead');
    expect(text(none)).toContain(
      "Online training isn't ready. Pick an online service under Agent's model in Advanced settings.",
    );
    expect(none).toContain('Set up online training');
    // Its key isn't saved: the same.
    const key = render(jobOf('local'), NO_KEY);
    expect(key).not.toContain('Train online instead');
    expect(text(key)).toContain("Online training isn't ready. Add an OpenRouter key");
    expect(key).toContain('Set up online training');
    // Still looking for the key: it says so, and has nothing to set up yet.
    const looking = render(jobOf('local'), CHECKING);
    expect(text(looking)).toContain("Online training isn't ready. Checking for a saved key.");
    expect(looking).not.toContain('Set up online training');
    expect(looking).not.toContain('Train online instead');
  });

  it('offers more time alone when training online would be too slow as well', () => {
    // 20 minutes: this computer can't score the check tasks, and online can't fit a round either.
    const html = render(jobOf('local', 20));
    expect(html).toContain('>Allow more time</button>');
    expect(html).not.toContain('Train online instead');
    expect(text(html)).toContain("Training on this computer won't get to teach in 20 minutes");
  });

  it("says online won't get to teach when online is where it trains, with nothing else to offer", () => {
    const html = render(jobOf('hosted', 20));
    expect(text(html)).toContain("Training online won't get to teach in 20 minutes");
    expect(text(html)).toContain('Glimmer takes about 15 seconds a task online');
    expect(html).toContain('>Allow more time</button>');
    expect(html).not.toContain('instead');
  });

  it('says nothing of the kind where a round fits, and keeps the quiet link for the other place', () => {
    // Training online fits; this computer, which is not chosen, doesn't.
    const html = render(jobOf('hosted'));
    expect(text(html)).not.toContain("won't get to teach");
    expect(text(html)).toContain('Too slow for the 3-hour limit');
    expect(html.match(/>Allow more time</g)).toHaveLength(1);
    // And where both fit there is nothing to say about time at all.
    const roomy = render(jobOf('local', 2000));
    expect(text(roomy)).not.toContain("won't get to teach");
    expect(roomy).not.toContain('Allow more time');
  });
});

describe('the online place', () => {
  it('says what is sent, and what it costs where a service is chosen, even before its key is saved', () => {
    for (const hosted of [READY, NO_KEY]) {
      const words = text(render(jobOf('hosted'), hosted));
      expect(words).toMatch(/Faster: about 15 seconds a task/);
      expect(words).toMatch(/About \$\d+(\.\d+)? · sends tasks and files online/);
    }
    expect(text(render(jobOf('hosted'), NO_KEY))).toContain(
      'Add an OpenRouter key in Advanced settings',
    );
  });

  it('says what is sent before a service is chosen, and asks for one in plain words', () => {
    const base = makeJob();
    const { hosted: _none, ...student } = jobOf('local').student;
    const words = text(render({ ...base, student: { ...student, trainOn: 'local' } }, NO_SERVICE));
    expect(words).toContain('Sends tasks and files online');
    expect(words).toContain("Pick an online service under Agent's model in Advanced settings");
    expect(words).not.toMatch(/\bhost\b/i);
  });
});
