import { expect, test, type Page } from '@playwright/test';
import type { Job } from '@architect/shared';
import { goTo, launchApp, settle } from './app';
import { startFakeStudent } from './models';
import { recordedData, recordedSummary } from './recorded';

/*
 * Getting back to a run, on the real engine: a run recorded with the engine's fakes that ended
 * with no one to take its agent, and a run that ends while the person is on another screen. The
 * stand-in specs in `runs.spec.ts` cover each screen's states; here nothing is stubbed.
 */

test.describe.configure({ mode: 'serial' });

const agents = (page: Page) => page.getByRole('navigation', { name: 'Agents' });

/** A name as a pattern that matches only itself. */
const escaped = (text: string) => text.replace(/[^\w\s]/g, '\\$&');

test('lists the results of a run nobody has taken the agent of, and opens them', async () => {
  const summary = await recordedSummary();
  const launched = await launchApp({
    data: recordedData(),
    settings: { onboarded: true, theme: 'dark' },
  });
  try {
    const { page } = launched;
    const [listed] = await page.evaluate(() => window.architect.jobs.list());
    expect(listed?.latestRun).toMatchObject({
      id: summary.runId,
      method: 'architect',
      status: 'finished',
      accepted: false,
    });
    await goTo(page, '/');
    const row = agents(page).getByRole('button', {
      name: new RegExp(`${escaped(listed?.name ?? '')}.*Results ready`),
    });
    await expect(row).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(new RegExp(`#/runs/${summary.runId}/report$`));
    await expect(page.getByRole('button', { name: 'See all rounds' })).toBeVisible();

    // Once the agent is the person's, its row is no longer a result to open.
    if (summary.graduateId === null) throw new Error('The recorded run made no agent.');
    await page.evaluate((id) => window.architect.graduates.accept(id), summary.runId);
    await goTo(page, '/');
    await expect(agents(page).getByRole('button', { name: /^New chat with/ })).toBeVisible();
    await expect(agents(page).getByRole('button', { name: /Results ready/ })).toHaveCount(0);
  } finally {
    await launched.close();
  }
});

test('lists the agent a run made the moment it ended, without a restart or a reload', async () => {
  const launched = await launchApp({ settings: { onboarded: true, theme: 'dark' } });
  const student = await startFakeStudent();
  try {
    const { page } = launched;
    const job = await page.evaluate(() => window.architect.jobs.createSample());
    const local: Job['student']['local'] = {
      runtime: 'openai_compatible',
      baseUrl: student.baseUrl,
      model: 'fake-student',
      contextLength: 16_384,
    };
    await page.evaluate((next) => window.architect.jobs.save(next), {
      ...job,
      student: { ...job.student, local },
    });

    // The person is on the home screen, which has read that there is no agent yet.
    await goTo(page, '/');
    await settle(page);
    await expect(agents(page)).toBeVisible();
    await expect(agents(page).getByRole('button', { name: /^New chat with/ })).toHaveCount(0);

    const run = await page.evaluate(
      (id) => window.architect.runs.start(id, { method: 'bare', seed: 7 }),
      job.id,
    );
    await expect
      .poll(() => page.evaluate((id) => window.architect.runs.get(id), run.id), {
        timeout: 120_000,
      })
      .toMatchObject({ run: { status: 'finished' } });

    // The engine made the agent when the run ended; the screen heard of it and read the list again.
    await expect(
      agents(page).getByRole('button', { name: new RegExp(`^New chat with ${escaped(job.name)}`) }),
    ).toBeVisible();
    // A baseline is never a run to open: the job has no row of its own for it.
    await expect(agents(page).getByRole('button', { name: /Results ready/ })).toHaveCount(0);
  } finally {
    student.server.close();
    await launched.close();
  }
});
