import {
  CalibrationCostSchema,
  ComparisonReportSchema,
  ProjectionSchema,
  type ComparisonReport,
  type ExperimentRecord,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';

/*
 * A stand-in for the engine's experiments (decision 074), with state, in the main process: plan,
 * revise, calibrate, preregister, start, pause, resume, stop, list and get, each sending the
 * event the engine would. A started experiment stays running until `finishExperiments`, which
 * releases its tests and gives it the recorded comparison's report; before that its report
 * holds no locked result, as the engine's never does. Screens are built against it.
 */

/** What the stand-in answers with, made from a comparison's report. */
function experimentsData(report: ComparisonReport) {
  const projection = ProjectionSchema.parse(report.projection);
  return {
    projection,
    calibration: CalibrationCostSchema.parse({
      tasks: report.job.counts.calibration,
      studentUsdEstimate: report.job.counts.calibration * 0.01,
      studentUsdCap: projection.caps.studentUsd,
      studySparkUsdCap: null,
    }),
    released: ComparisonReportSchema.parse(report),
    // While it runs: each arm as far as development, no locked result.
    held: ComparisonReportSchema.parse({
      ...report,
      plan: { ...report.plan, releasedAt: null, seedResults: [] },
      backends: [],
      arms: report.arms.map((arm) => ({
        ...arm,
        status: arm.status === 'not_run' ? 'not_run' : 'incomplete',
        measuredOn: [],
      })),
    }),
  };
}

/**
 * Installs the stand-in; `report` is what a finished experiment reads, such as the recorded one,
 * and `kept` the experiments it already holds, such as a finished one.
 */
export async function installExperimentsFake(
  app: ElectronApplication,
  report: ComparisonReport,
  kept: readonly ExperimentRecord[] = [],
): Promise<void> {
  // Sent untyped: the report's types are too deep for Playwright to unbox, and it is ours anyway.
  const sent: unknown = { data: experimentsData(report), kept };
  await app.evaluate(({ BrowserWindow, ipcMain }, raw) => {
    const { data, kept } = raw as {
      data: ReturnType<typeof experimentsData>;
      kept: Record[];
    };
    type Record = {
      id: string;
      input: { jobId?: string; jobDir?: string; name: string };
      job: { id: string; name: string; splitsSeed: number };
      status: string;
      reason?: string;
      preregistration: { at: string; sha256: string; pinned: unknown } | null;
      calibratedAt: string | null;
      runningMs: number;
      createdAt: string;
      updatedAt: string;
    };
    const records: Record[] = [...kept];
    const now = () => new Date().toISOString();
    const broadcast = (channel: string, payload: unknown) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
    };
    const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
    const find = (id: string) => {
      const found = records.find((record) => record.id === id);
      if (!found) throw coded('experiment_not_found', `There is no experiment "${id}".`);
      return found;
    };
    const update = (record: Record, patch: Partial<Record>) => {
      Object.assign(record, patch, { updatedAt: now() });
      if (patch.reason === undefined) delete record.reason;
      broadcast('experiments:onEvent', {
        type: 'experiment.updated',
        experimentId: record.id,
        at: now(),
        experiment: record,
      });
      return { ...record };
    };
    const released = (record: Record) => record.status === 'finished';
    const detail = (record: Record) => ({
      experiment: { ...record },
      projection: data.projection,
      calibration: data.calibration,
      groups: ['all', 'seen', 'unseen'],
      study: null,
      released: released(record),
      funding: null,
      amendments: [],
      report: released(record) ? data.released : record.status === 'draft' ? null : data.held,
    });
    const handle = (channel: string, reply: (...args: never[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        try {
          return { ok: true, value: await reply(...(args as never[])) };
        } catch (error) {
          const failure = error as Error & { code?: string };
          return { ok: false, error: { message: failure.message, code: failure.code } };
        }
      });
    };

    handle('experiments:plan', (input: Record['input']) => {
      const at = now();
      const record: Record = {
        id: `cmp_${records.length + 1}`,
        input,
        job: {
          id: data.released.job.id,
          name: data.released.job.name,
          splitsSeed: data.released.job.splitsSeed,
        },
        status: 'draft',
        preregistration: null,
        calibratedAt: null,
        runningMs: 0,
        createdAt: at,
        updatedAt: at,
      };
      records.push(record);
      return detail(record);
    });
    handle('experiments:revise', (id: string, input: Record['input']) => {
      const record = find(id);
      if (record.preregistration !== null) {
        throw coded(
          'experiment_frozen',
          "It was preregistered; its arms, seeds and caps can't change.",
        );
      }
      return detail({ ...update(record, { input }) });
    });
    handle('experiments:calibrate', (id: string) => update(find(id), { calibratedAt: now() }));
    handle('experiments:preregister', (id: string) => {
      const record = find(id);
      if (record.preregistration !== null) {
        throw coded(
          'experiment_frozen',
          "It was preregistered; its arms, seeds and caps can't change.",
        );
      }
      return update(record, {
        status: 'preregistered',
        preregistration: {
          at: now(),
          sha256: '3f9a1c07d84e5b26a0c4e19f7b3d52866c1e0a4fd29b7358e6a01c4d9f2b7e35',
          pinned: data.released.inputs?.job,
        },
      });
    });
    const run = (id: string, from: string[]) => {
      const record = find(id);
      if (!from.includes(record.status)) {
        throw coded('experiment_state', `It is ${record.status}.`);
      }
      // Started a while ago, as a run under way would have been.
      return update(record, {
        status: 'running',
        reason: undefined,
        runningMs: record.runningMs || 47 * 60_000,
      });
    };
    handle('experiments:start', (id: string) => run(id, ['preregistered']));
    handle('experiments:resume', (id: string) =>
      run(id, ['paused', 'waiting', 'needs_funding', 'incomplete']),
    );
    handle('experiments:pause', (id: string) => {
      const record = find(id);
      if (record.status !== 'running') throw coded('experiment_state', `It is ${record.status}.`);
      return update(record, { status: 'paused' });
    });
    handle('experiments:stop', (id: string) =>
      update(find(id), { status: 'stopped', reason: 'Stopped by you.' }),
    );
    handle('experiments:list', () => records.map((record) => ({ ...record })).reverse());
    handle('experiments:get', (id: string) => detail(find(id)));
    (globalThis as unknown as { fakeExperiments: { finish: () => void } }).fakeExperiments = {
      finish: () => {
        for (const record of records.filter((item) => item.status === 'running')) {
          update(record, { status: 'finished', runningMs: record.runningMs + 60_000 });
        }
      },
    };
  }, sent);
}

/** Every running experiment finishes: its tests released, its report the recorded one. */
export async function finishExperiments(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    (globalThis as unknown as { fakeExperiments: { finish: () => void } }).fakeExperiments.finish();
  });
}
