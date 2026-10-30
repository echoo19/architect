import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { glimmerBuild, type LocalRuntimes } from '@architect/shared';
import { expect, type Locator, type Page } from '@playwright/test';
import { goTo } from '../e2e/app';
import { LOCAL_WITH_GLIMMER, stubEngine } from '../e2e/fixtures';
import type { DemoScene, DemoScript, StepContext } from './script';

/**
 * Architect's demo, recorded from the real app. It needs, from the environment:
 * - ARCHITECT_DEMO_RECORDS: a folder with a shop's `customers.csv`, `tickets.csv` and
 *   `policy.md`, which the teacher drafts a job from, live: the keys come from the environment
 *   by name (ARCHITECT_KEYS_FROM_ENV, a development build only), so the teacher is really called;
 * - ARCHITECT_DEMO_DRAFTED: a folder that doesn't exist yet, where the drafting scene keeps the
 *   app's data, so the job drafted on camera can be trained afterwards (scripts/run.ts --job);
 * - ARCHITECT_DEMO_RUN: that training run's id, for the scenes that replay it;
 * - ARCHITECT_DEMO_AGENT_DATA: an app data folder with the ready-made agent installed, its
 *   records bound to a scratch copy (it runs on this computer's model, so the GPU is used).
 * Record the drafting scene alone first (ARCHITECT_DEMO_ONLY), train its job, then record the
 * rest with that scene reused (ARCHITECT_DEMO_REUSE). Run it with ARCHITECT_DEMO_SCRIPT pointing
 * here; see README.md in this folder. The rule is checked and confirmed in a scene of its own, on
 * a copy of the drafted job with its confirmation taken out, so it can be recorded again as the
 * screen changes without asking the teacher again.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}; see the comment at the top of demo/architect.ts.`);
  return value;
}

const RECORDS = required('ARCHITECT_DEMO_RECORDS');
const DRAFTED = required('ARCHITECT_DEMO_DRAFTED');
const AGENT_DATA = required('ARCHITECT_DEMO_AGENT_DATA');
/** Read when a scene that replays the run starts, so the drafting scene can run before it exists. */
const RUN = process.env.ARCHITECT_DEMO_RUN ?? '';

const SETTINGS = { onboarded: true };
const MINUTES = 60_000;

/** Opens a round's drawer from the Rounds list, holds it, and closes it again. */
function openRound(round: number, holdMs: number) {
  return {
    kind: 'run' as const,
    label: `open round ${round}`,
    run: async ({ page, click }: StepContext) => {
      await click(
        page
          .getByRole('region', { name: 'Rounds' })
          .getByRole('button')
          .filter({ hasText: new RegExp(`^${String(round).padStart(2, '0')}`) }),
      );
      await expect(page.getByRole('dialog', { name: new RegExp(`^Round ${round}`) })).toBeVisible();
      await page.waitForTimeout(holdMs);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
  };
}

/** Opens each round the run had, oldest first and at most `most`, holding each one's page. */
function openRounds(most: number, holdMs: number) {
  return {
    kind: 'run' as const,
    label: 'open the rounds',
    run: async (context: StepContext) => {
      const rows = context.page
        .getByRole('region', { name: 'Rounds' })
        .getByRole('button')
        .filter({ hasText: /^\d{2}/ });
      const count = Math.min(most, await rows.count());
      if (count === 0) throw new Error('The run has no rounds to open.');
      for (let round = 1; round <= count; round += 1) {
        await openRound(round, holdMs).run(context);
        await sleep(500);
      }
    },
  };
}

/** Waits, as long as a local model needs, until a reply holds some text. */
function waitForText(text: string | RegExp, label: string) {
  return {
    kind: 'run' as const,
    label,
    run: async ({ page }: StepContext) => {
      await expect(page.getByText(text).last()).toBeVisible({ timeout: 6 * MINUTES });
    },
  };
}

/**
 * Waits until the agent's reply has finished: the composer shows Stop while a reply runs and
 * Send again once it ends. Then, when given, checks the reply says something it should.
 */
function waitForReply(label: string, says?: string) {
  return {
    kind: 'run' as const,
    label,
    run: async ({ page }: StepContext) => {
      const stop = page.getByRole('button', { name: 'Stop' });
      await stop.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
      await expect(stop).toHaveCount(0, { timeout: 6 * MINUTES });
      if (says !== undefined) await expect(page.getByText(says).last()).toBeVisible();
    },
  };
}

/**
 * Scrolls the screen evenly until `target` sits `topPx` below the top of what scrolls. Each step
 * is set from here rather than by the page's own animation, which a hidden window may hold back.
 */
async function glide(page: Page, target: Locator, topPx: number, ms: number): Promise<void> {
  const { from, to } = await target.evaluate((element, gap) => {
    let box = element.parentElement;
    while (
      box &&
      !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))
    ) {
      box = box.parentElement;
    }
    const scroller = box ?? document.documentElement;
    scroller.setAttribute('data-demo-scroller', '');
    const top = box ? box.getBoundingClientRect().top : 0;
    const most = scroller.scrollHeight - scroller.clientHeight;
    const offset = element.getBoundingClientRect().top - top - gap;
    return {
      from: scroller.scrollTop,
      to: Math.max(0, Math.min(most, scroller.scrollTop + offset)),
    };
  }, topPx);
  const start = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - start) / ms);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    await page.evaluate(
      (y) => {
        const scroller = document.querySelector('[data-demo-scroller]');
        if (scroller) scroller.scrollTop = y;
      },
      from + (to - from) * eased,
    );
    if (t === 1) return;
    await sleep(16);
  }
}

function glideTo(label: string, target: (page: Page) => Locator, topPx = 96, ms = 1200) {
  return {
    kind: 'run' as const,
    label,
    run: ({ page }: StepContext) => glide(page, target(page), topPx, ms),
  };
}

const ANSWERS = (page: Page) => page.getByRole('group', { name: 'Answers' }).getByRole('button');
const REVIEW = (page: Page) => page.getByRole('button', { name: 'Review the job' });

/** Waits for the teacher's next turn: a question with answers to pick, or the finished draft. */
function untilTeacher(label: string) {
  return {
    kind: 'run' as const,
    label,
    run: async ({ page }: StepContext) => {
      await expect(ANSWERS(page).first().or(REVIEW(page))).toBeVisible({ timeout: 5 * MINUTES });
    },
  };
}

/**
 * What the shop in the demo would answer, by what the question is about: its policy gives the
 * member discount on labor only, bills labor in half-hour steps rounded up, charges parts at what
 * the shop paid, and an empty parts cost is nothing. A topic is found in the question or in its
 * answers (Architect's own question about an empty cell always offers "Count it as zero"), and the
 * topics are checked in this order, so empty parts costs come before parts in general.
 */
const ANSWERS_BY_TOPIC: readonly [about: RegExp, answer: RegExp][] = [
  [/discount|10%|members?/i, /labor only|not (on )?parts|never.*parts/i],
  [/round|half.hour/i, /round(ed)? up|up to the next/i],
  [/empty|blank|missing|no parts cost|as zero/i, /as zero|count it as 0/i],
  [/parts|include|pay/i, /at cost|as written|what the shop paid/i],
];

/** The answer to pick: the shop's, when the question is about something the policy settles. */
function shopAnswer(question: string, options: readonly string[]): number {
  const subject = `${question} ${options.join(' ')}`;
  for (const [about, answer] of ANSWERS_BY_TOPIC) {
    if (!about.test(subject)) continue;
    const found = options.findIndex((option) => answer.test(option));
    if (found >= 0) return found;
  }
  throw new Error(`No answer of the shop's fits "${question}": ${options.join(' | ')}`);
}

/** Picks an answer when the teacher asked something, after a moment to read the question. */
function answerTeacher(label: string) {
  return {
    kind: 'run' as const,
    label,
    run: async ({ page, click }: StepContext) => {
      const options = ANSWERS(page);
      if ((await options.count()) === 0) return;
      const question = await page
        .getByRole('group', { name: 'Answers' })
        .filter({ has: page.getByRole('button') })
        .last()
        .locator('xpath=preceding-sibling::p[1]')
        .textContent();
      const choice = shopAnswer(question ?? '', await options.allTextContents());
      await sleep(1800);
      await click(options.nth(choice));
      // The answered question's choices stop being buttons, so the next wait can't take them for
      // a new question.
      await expect(options).toHaveCount(0, { timeout: 10_000 });
    },
  };
}

const RULE = (page: Page) => page.getByRole('region', { name: /^Check the rules?$/ });
const CONFIRM = (page: Page) => RULE(page).getByRole('button', { name: /^Confirm the rules?$/ });

/** Stops a scene that replays the training run when no run was named. */
const NEEDS_RUN = {
  kind: 'run' as const,
  label: 'the run to replay',
  run: async () => {
    if (!RUN) throw new Error('Set ARCHITECT_DEMO_RUN; see the comment at the top of this file.');
  },
};

const describe: DemoScene = {
  name: 'Describe a job',
  launch: { settings: SETTINGS, env: { ARCHITECT_KEYS_FROM_ENV: '1' } },
  keepData: DRAFTED,
  prepare: [
    { kind: 'resize', width: 1440, height: 900 },
    { kind: 'route', path: '/new' },
    { kind: 'visible', role: 'textbox', name: 'Describe the job' },
  ],
  title: {
    eyebrow: 'Your own job',
    heading: 'Say what it should do, and hand over the records',
    seconds: 2.6,
  },
  steps: [
    {
      kind: 'type',
      role: 'textbox',
      name: 'Describe the job',
      text: "Tell customers what a repair ticket costs under our pricing policy, labor billed in half-hour steps, and look up a customer's contact details.",
      delayMs: 16,
    },
    {
      kind: 'answerFileDialog',
      files: ['customers.csv', 'tickets.csv', 'policy.md'].map((file) => join(RECORDS, file)),
    },
    { kind: 'click', role: 'button', name: 'Attach files' },
    { kind: 'text', text: 'policy.md' },
    { kind: 'wait', ms: 900 },
    { kind: 'click', role: 'button', name: 'Send' },
    untilTeacher('the first reply'),
    answerTeacher('the first answer'),
    untilTeacher('the second reply'),
    answerTeacher('the second answer'),
    untilTeacher('the third reply'),
    answerTeacher('the third answer'),
    untilTeacher('the draft'),
    { kind: 'wait', ms: 2800 },
  ],
  // The teacher takes half a minute or so per reply: shown four times faster.
  speedups: [
    { fromStep: 6, throughStep: 6, factor: 4 },
    { fromStep: 8, throughStep: 8, factor: 4 },
    { fromStep: 10, throughStep: 10, factor: 4 },
    { fromStep: 12, throughStep: 12, factor: 4 },
  ],
  tailMs: 400,
};

/** The job the drafting scene made, found in the copy of its data when the next scene starts. */
let draftedJob = '';

/**
 * This computer as the film was made on it, told by a stand-in so that no local model runtime is
 * asked: Ollama with both of Glimmer's builds, and a 12 GB graphics card.
 */
const THIS_COMPUTER: LocalRuntimes = {
  ...LOCAL_WITH_GLIMMER,
  ollama: {
    ...LOCAL_WITH_GLIMMER.ollama,
    models: [
      {
        id: glimmerBuild('glimmer-4bit').model,
        sizeBytes: glimmerBuild('glimmer-4bit').diskBytes,
      },
      ...LOCAL_WITH_GLIMMER.ollama.models,
    ],
  },
};

const rule: DemoScene = {
  name: 'Check the rule',
  launch: {
    settings: SETTINGS,
    data: DRAFTED,
    env: { ARCHITECT_KEYS_FROM_ENV: '1' },
    // The copy is the job as drafted, before its rule was confirmed.
    prepare: async (userData) => {
      const jobs = await readdir(join(userData, 'jobs'));
      if (jobs.length !== 1) throw new Error(`Expected the one drafted job, found ${jobs.length}`);
      draftedJob = jobs[0] ?? '';
      await rm(join(userData, 'jobs', draftedJob, 'confirmation.json'), { force: true });
    },
  },
  setup: (launched) => stubEngine(launched.app, { 'connections:detectLocal': THIS_COMPUTER }),
  prepare: [
    { kind: 'resize', width: 1440, height: 900 },
    {
      kind: 'run',
      label: 'open the drafted job',
      run: async ({ page }) => {
        await goTo(page, `/jobs/${encodeURIComponent(draftedJob)}/define`);
        await expect(RULE(page)).toBeVisible({ timeout: MINUTES });
      },
    },
  ],
  title: {
    eyebrow: 'Before it trains',
    heading: 'Nothing trains until you confirm the rule',
    seconds: 2.4,
  },
  steps: [
    { kind: 'wait', ms: 1600 },
    glideTo('to the rule', (page) => RULE(page)),
    { kind: 'wait', ms: 4200 },
    glideTo('to the steps', (page) => RULE(page).getByText('The rule, in words', { exact: true })),
    { kind: 'wait', ms: 4200 },
    glideTo('to an example', (page) => RULE(page).getByText('Examples', { exact: true })),
    { kind: 'wait', ms: 4200 },
    glideTo('to the confirmation', CONFIRM, 560),
    { kind: 'wait', ms: 1400 },
    {
      kind: 'run',
      label: 'confirm the rule',
      run: ({ page, click }) => click(CONFIRM(page)),
    },
    { kind: 'text', text: 'Confirmed on' },
    { kind: 'wait', ms: 900 },
    glideTo('back to the top', (page) => page.getByRole('heading', { level: 1 })),
    { kind: 'wait', ms: 2600 },
  ],
  tailMs: 400,
};

const learn: DemoScene = {
  name: 'Watch it learn',
  launch: { settings: SETTINGS, data: DRAFTED },
  prepare: [
    NEEDS_RUN,
    { kind: 'resize', width: 1440, height: 900 },
    { kind: 'route', path: `/runs/${RUN}/train` },
    { kind: 'text', text: 'on check tasks' },
  ],
  title: {
    eyebrow: 'Training, recorded as it ran',
    heading: 'Spark teaches. A change stays only if it helps.',
    seconds: 2.4,
  },
  steps: [{ kind: 'wait', ms: 3200 }, openRounds(2, 6400), { kind: 'wait', ms: 600 }],
  tailMs: 400,
};

const test: DemoScene = {
  name: 'The final test',
  launch: { settings: SETTINGS, data: DRAFTED },
  prepare: [
    NEEDS_RUN,
    { kind: 'resize', width: 1440, height: 900 },
    { kind: 'route', path: `/runs/${RUN}/report` },
    { kind: 'text', text: 'of new tasks right' },
  ],
  title: {
    eyebrow: 'The final test',
    heading: 'Then requests it has never seen, graded by your rule',
    seconds: 2.4,
  },
  steps: [
    { kind: 'wait', ms: 3600 },
    { kind: 'scroll', y: 520 },
    { kind: 'wait', ms: 2800 },
    { kind: 'scroll', y: 560 },
    { kind: 'wait', ms: 3000 },
  ],
  tailMs: 400,
};

const COMPOSER = 'Message Returns desk';

const local: DemoScene = {
  name: 'On your computer',
  launch: { settings: SETTINGS, data: AGENT_DATA },
  prepare: [
    { kind: 'resize', width: 1440, height: 900 },
    { kind: 'route', path: '/' },
    { kind: 'visible', role: 'button', name: 'New chat with Returns desk' },
  ],
  title: {
    eyebrow: 'On your computer',
    heading: 'A trained agent works offline, and asks before it changes a file',
    seconds: 2.6,
  },
  steps: [
    { kind: 'click', role: 'button', name: 'New chat with Returns desk' },
    { kind: 'visible', role: 'textbox', name: COMPOSER },
    {
      kind: 'type',
      role: 'textbox',
      name: COMPOSER,
      text: 'Which orders did orrin.castellanos@example.com place in October 2026, and what was in each?',
      delayMs: 26,
    },
    { kind: 'click', role: 'button', name: 'Send' },
    waitForReply('the orders answer', 'ORD-10502'),
    { kind: 'wait', ms: 3800 },
    {
      kind: 'type',
      role: 'textbox',
      name: COMPOSER,
      text: 'Orrin is sending back the dry bag from ORD-10482, return RT-4106. Book the earliest carrier pickup.',
      delayMs: 26,
    },
    { kind: 'click', role: 'button', name: 'Send' },
    waitForText(/Add to data\/pickups\.csv/, 'the approval card'),
    { kind: 'wait', ms: 3400 },
    { kind: 'click', role: 'button', name: 'Allow once' },
    waitForReply('the booked pickup', 'PU-4106'),
    { kind: 'wait', ms: 3200 },
    {
      kind: 'type',
      role: 'textbox',
      name: COMPOSER,
      text: 'Write a short poem about our tents for the newsletter.',
      delayMs: 26,
    },
    { kind: 'click', role: 'button', name: 'Send' },
    waitForReply('the refusal'),
    { kind: 'wait', ms: 3000 },
  ],
  // The local model's replies take a minute or more on a 12 GB card: shown four times faster.
  speedups: [
    { fromStep: 4, throughStep: 4, factor: 4 },
    { fromStep: 8, throughStep: 8, factor: 4 },
    { fromStep: 11, throughStep: 11, factor: 4 },
    { fromStep: 15, throughStep: 15, factor: 4 },
  ],
  tailMs: 600,
};

const measured: DemoScene = {
  name: 'Measured',
  launch: { settings: SETTINGS },
  title: {
    eyebrow: 'Planned before it ran',
    heading: 'In a comparison, teaching took the returns desk from 44 to 58 of 60 right',
    seconds: 4.2,
  },
  steps: [],
};

const opening: DemoScene = {
  name: 'Opening',
  launch: { settings: SETTINGS },
  title: {
    eyebrow: 'Architect',
    heading: 'Muse Spark teaches Muse Glimmer your job. Then Glimmer does it on your computer.',
    seconds: 3.6,
  },
  steps: [],
};

const closing: DemoScene = {
  name: 'Architect',
  launch: { settings: SETTINGS },
  title: {
    eyebrow: 'github.com/echoo19/architect',
    heading: 'Open source, for Windows and Mac',
    seconds: 3.4,
  },
  steps: [],
};

const script: DemoScript = {
  width: 1440,
  height: 900,
  fps: 30,
  crossfadeSeconds: 0.4,
  scenes: [opening, describe, rule, learn, test, local, measured, closing],
};

export default script;
