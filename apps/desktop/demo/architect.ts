import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { DemoScene, DemoScript, StepContext } from './script';

/**
 * Architect's demo, recorded from the real app. It needs, from the environment:
 * - ARCHITECT_DEMO_COMPARISON: a comparisons runner's output folder whose targeted arm is
 *   replayed from its own records (comparison 2's, for the published demo);
 * - ARCHITECT_DEMO_AGENT_DATA: an app data folder with the ready-made agent installed, its
 *   records bound to a scratch copy (it runs on this computer's model, so the GPU is used).
 * Run it with ARCHITECT_DEMO_SCRIPT pointing here; see README.md in this folder.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}; see the comment at the top of demo/architect.ts.`);
  return value;
}

const COMPARISON = required('ARCHITECT_DEMO_COMPARISON');
const AGENT_DATA = required('ARCHITECT_DEMO_AGENT_DATA');

/** The targeted arm's run, as the comparison's own report names it. */
const report = JSON.parse(readFileSync(join(COMPARISON, 'report.json'), 'utf8')) as {
  arms: { arm: string; runId: string | null }[];
};
const RUN = report.arms.find((arm) => arm.arm === 'targeted')?.runId;
if (!RUN) throw new Error('The comparison has no targeted run to replay.');

const SETTINGS = { onboarded: true, theme: 'dark' as const };
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

const learn: DemoScene = {
  name: 'Watch it learn',
  launch: { settings: SETTINGS, comparison: COMPARISON },
  title: {
    eyebrow: 'A real training run',
    heading: 'Spark teaches. A change stays only if it helps.',
    seconds: 2.4,
  },
  steps: [
    { kind: 'resize', width: 1440, height: 900 },
    { kind: 'route', path: `/runs/${RUN}/train` },
    { kind: 'text', text: 'on check tasks' },
    { kind: 'wait', ms: 3200 },
    openRound(1, 5200),
    { kind: 'wait', ms: 500 },
    openRound(2, 3400),
    { kind: 'wait', ms: 600 },
  ],
  tailMs: 400,
};

const test: DemoScene = {
  name: 'The final test',
  launch: { settings: SETTINGS, comparison: COMPARISON },
  title: { eyebrow: 'The final test', heading: 'Then 60 requests it has never seen', seconds: 2.2 },
  steps: [
    { kind: 'resize', width: 1440, height: 900 },
    { kind: 'route', path: `/runs/${RUN}/report` },
    { kind: 'text', text: 'of new tasks right' },
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
  title: {
    eyebrow: 'On your computer',
    heading: 'It works offline, and asks before it changes a file',
    seconds: 2.6,
  },
  steps: [
    { kind: 'resize', width: 1440, height: 900 },
    { kind: 'route', path: '/' },
    { kind: 'visible', role: 'button', name: 'New chat with Returns desk' },
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
    { fromStep: 7, throughStep: 7, factor: 4 },
    { fromStep: 11, throughStep: 11, factor: 4 },
    { fromStep: 14, throughStep: 14, factor: 4 },
    { fromStep: 18, throughStep: 18, factor: 4 },
  ],
  tailMs: 600,
};

const script: DemoScript = {
  width: 1440,
  height: 900,
  fps: 30,
  crossfadeSeconds: 0.4,
  scenes: [learn, test, local],
};

export default script;
