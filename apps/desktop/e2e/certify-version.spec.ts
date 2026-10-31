import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Certificate, CertifyRequest, FieldView, JobSummary } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { TUTOR_CERTIFICATE } from './fixtures-certify';
import { stubByKey } from './fixtures-flow';
import { TUTOR_FIELD } from './fixtures-fields';
import { LAB, LAB_JOBS } from './fixtures-lab';
import { installModelsFake, MODEL_VERSIONS, MODELS } from './fixtures-models';

/*
 * Certifying a version after the fact (decision 079) against a stand-in engine: from a version's
 * panel in Models, the settings and the job its tasks come from, a refusal said in the dialog,
 * what it will cost before anything spends, its progress, and the certificate it files. The
 * personal edition has no Models, so no way to it.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };

/** The tutor's job imported again with more tasks, and a third academy it seals. */
const NEWER: JobSummary = {
  id: 'job_tutor_more',
  name: 'Tutor',
  createdAt: '2026-10-30T09:00:00.000Z',
  taskCount: 312,
};
const NEWER_FIELD: FieldView = {
  ...TUTOR_FIELD,
  jobId: NEWER.id,
  sealed: [...TUTOR_FIELD.sealed, { name: 'Brookfield Academy', synthetic: true, files: 12 }],
};

/** What the stand-in files once the attempts are made: Tutor's certificate, checked where asked. */
const CERTIFICATE: Certificate = {
  ...TUTOR_CERTIFICATE,
  n: 60,
  ...(TUTOR_CERTIFICATE.issued
    ? {
        checks: [
          {
            org: 'summit',
            orgName: 'Summit Tutoring',
            seen: true,
            synthetic: true,
            tasks: 12,
            answered: 9,
            errors: 0,
            held: true,
          },
          {
            org: 'brookfield',
            orgName: 'Brookfield Academy',
            seen: false,
            synthetic: true,
            tasks: 24,
            answered: 17,
            errors: 1,
            held: true,
          },
        ],
      }
    : {}),
} as Certificate;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  const visible = await launched.app.evaluate(({ BrowserWindow }, size) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(size.width, size.height);
    return main.isVisible();
  }, SIZE);
  expect(visible).toBe(false);
  await mkdir(OUT_DIR, { recursive: true });
  await updateSettings(page, { onboarded: true, edition: 'lab' });
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

/**
 * Models with Tutor's versions made by runs here, the jobs and fields, and a certification the
 * stand-in moves along each time it is read: planned, then certifying, then finished.
 */
async function installCertifyFake(): Promise<void> {
  await installModelsFake(launched.app);
  await stubByKey(launched.app, 'jobs:field', {
    [LAB.tutorJob]: TUTOR_FIELD,
    [NEWER.id]: NEWER_FIELD,
  });
  await launched.app.evaluate(
    ({ ipcMain }, data) => {
      const store = globalThis as typeof globalThis & { certifyCalls?: unknown[] };
      store.certifyCalls = [];
      const handle = (channel: string, reply: (...args: never[]) => unknown) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
          try {
            return { ok: true, value: await reply(...(args as never[])) };
          } catch (error) {
            return { ok: false, error: { message: (error as Error).message } };
          }
        });
      };
      const counts: Record<string, { org: string; orgName: string; seen: boolean; tasks: number }> =
        {
          summit: { org: 'summit', orgName: 'Summit Tutoring', seen: true, tasks: 12 },
          'Brookfield Academy': {
            org: 'brookfield',
            orgName: 'Brookfield Academy',
            seen: false,
            tasks: 24,
          },
        };
      type Stored = Record<string, unknown> & {
        id: string;
        status: string;
        done: number;
        plan: Record<string, unknown> & { attempts: number };
      };
      let certifications: Stored[] = [];
      handle('jobs:list', () => data.jobs);
      handle('graduates:versions', (id: string) =>
        (data.versions[id] ?? []).map((version) => ({
          ...version,
          runId: `run_${id}_${version.version}`,
        })),
      );
      handle('graduates:planCertification', (request: CertifyRequest) => {
        store.certifyCalls?.push(request);
        if (request.check.includes('Harbor Learning')) {
          throw new Error(
            "Version 2's run was already tested on Harbor Learning, so a check there wouldn't be on requests it never saw.",
          );
        }
        const checks = request.check.map((key) => ({ ...counts[key], synthetic: true }));
        const attempts =
          request.k * (request.size + checks.reduce((sum, check) => sum + (check.tasks ?? 0), 0));
        const planned: Stored = {
          id: `crt_${certifications.length + 1}`,
          graduateId: request.graduateId,
          version: request.version,
          runId: 'run_tutor_2',
          request,
          plan: {
            jobName: 'Tutor',
            target: 'local',
            student: 'muse-glimmer:30b',
            calibration: request.size,
            checks,
            attempts,
            usd: 0,
            seconds: attempts * 150,
          },
          inputs: {
            sealedSha256: 'a'.repeat(64),
            calibrationSha256: 'b'.repeat(64),
            checksSha256: {},
            harnessHash: 'c'.repeat(64),
            adapterSha256: null,
            seeds: [1, 2, 3, 4, 5],
          },
          status: 'planned',
          done: 0,
          spentUsd: 0,
          createdAt: '2026-10-30T10:00:00.000Z',
        };
        certifications = [planned, ...certifications.filter((item) => item.status !== 'planned')];
        return planned;
      });
      handle('graduates:discardCertification', (id: string) => {
        certifications = certifications.filter((item) => item.id !== id);
      });
      handle('graduates:startCertification', (id: string) => {
        const found = certifications.find((item) => item.id === id);
        if (!found) throw new Error('There is no such certification.');
        found.status = 'certifying';
        return found;
      });
      handle('graduates:certifications', () => {
        for (const item of certifications) {
          if (item.status !== 'certifying') continue;
          item.done = Math.min(item.plan.attempts, item.done + Math.ceil(item.plan.attempts / 3));
          if (item.done === item.plan.attempts) {
            item.status = 'finished';
            item.certificate = data.certificate;
            item.endedAt = '2026-10-30T22:00:00.000Z';
          }
        }
        return certifications;
      });
    },
    {
      jobs: [...LAB_JOBS, NEWER],
      versions: MODEL_VERSIONS,
      certificate: CERTIFICATE,
    },
  );
}

const dialog = () => page.getByRole('dialog', { name: 'Certify version 2' });

test('certifies a version from its panel: settings, cost, progress, then its certificate', async () => {
  await installCertifyFake();
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/models');
  await page
    .getByRole('table', { name: 'Models' })
    .getByRole('row', { name: /^Tutor\s+version 2/ })
    .click();
  const panel = page.getByRole('complementary', { name: 'Model' });
  await panel.getByRole('button', { name: 'Certify' }).click();

  // The newest job of its field is offered first: its tasks are new to version 2.
  await expect(dialog().getByRole('combobox', { name: 'Tasks from' })).toContainText('Tutor ·');
  await expect(dialog().getByRole('textbox', { name: 'Calibration tasks' })).toHaveValue('60');
  await expect(dialog().getByRole('textbox', { name: 'Tries per task' })).toHaveValue('5');
  await expect(dialog().getByRole('textbox', { name: 'Wrong at most' })).toHaveValue('10');
  await expect(dialog().getByRole('textbox', { name: 'Confidence' })).toHaveValue('95');
  const checks = dialog().getByRole('group', { name: 'Check at' });
  await expect(checks.getByRole('checkbox')).toHaveCount(6);

  // A check where its run was already tested is refused, in the engine's words.
  await checks.getByRole('checkbox', { name: 'Harbor Learning' }).click();
  await dialog().getByRole('button', { name: 'Review' }).click();
  await expect(dialog()).toContainText('already tested on Harbor Learning');
  await checks.getByRole('checkbox', { name: 'Harbor Learning' }).click();
  await checks.getByRole('checkbox', { name: 'Summit Tutoring' }).click();
  await checks.getByRole('checkbox', { name: 'Brookfield Academy' }).click();
  await dialog().getByRole('button', { name: 'Review' }).click();

  const plan = dialog().getByRole('list', { name: 'What it will do' });
  await expect(plan).toContainText('60 tasks of Tutor that version 2 never saw');
  await expect(plan).toContainText(
    'Checked at Summit Tutoring (12 tasks), Brookfield Academy (24 tasks)',
  );
  await expect(plan).toContainText('480 tries, 5 at each task');
  await expect(plan).toContainText('Free');
  const asked = await launched.app.evaluate(() =>
    (globalThis as typeof globalThis & { certifyCalls?: unknown[] }).certifyCalls?.at(-1),
  );
  expect(asked).toMatchObject({
    graduateId: MODELS.tutorId,
    version: 2,
    jobId: NEWER.id,
    k: 5,
    epsilon: 0.1,
    delta: 0.05,
    size: 60,
    check: ['summit', 'Brookfield Academy'],
    maxUsd: 0,
    maxMinutes: 1440,
  });

  await dialog().getByRole('button', { name: 'Certify', exact: true }).click();
  await expect(dialog().getByRole('progressbar', { name: 'Certifying' })).toBeVisible();
  const certificate = dialog().getByRole('region', { name: 'Certified answers' });
  await expect(certificate).toContainText(
    'When Tutor answers, it is wrong on at most 8% of requests like these, with 95% confidence.',
    { timeout: 15_000 },
  );
  await expect(certificate).toContainText(
    'Measured on 60 calibration tasks it was never taught on',
  );
  const where = certificate.getByRole('list', { name: 'Where the bound was checked' });
  await expect(where.getByRole('listitem').nth(0)).toContainText('New tasks at Summit Tutoring');
  await expect(where.getByRole('listitem').nth(1)).toContainText('Brookfield Academy');
  await capture('certify-version-dark.png');

  // Opened again, it shows the certificate it filed.
  await dialog().getByRole('button', { name: 'Close' }).click();
  await expect(dialog()).toBeHidden();
  await panel.getByRole('button', { name: 'Certify' }).click();
  await expect(dialog().getByRole('region', { name: 'Certified answers' })).toBeVisible();
  await expect(dialog().getByRole('button', { name: 'Certify again' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('the personal edition has no Models, so no way to certify', async () => {
  await updateSettings(page, { edition: 'personal' });
  await goTo(page, '/models');
  await expect(page.getByRole('table', { name: 'Models' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Certify' })).toHaveCount(0);
  await updateSettings(page, { edition: 'lab' });
});
