import { harnessToFiles } from '@architect/harness';
import { contractTerms, JobContractSchema, type Job } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPackage, type VersionFacts } from '../src/graduates/build';
import { JobLibrary } from '../src/loop/jobs';
import { reportFor } from './agent-host/graduates';
import { FakeRuntime, FakeVault } from './fakes/runtime';
import { harnessWith, newComputer, type Computer } from './support/computer';
import { makeJob } from './support/fixtures';

const made: Computer[] = [];

afterEach(async () => {
  for (const computer of made.splice(0)) await computer.remove();
});

async function setup(): Promise<{ computer: Computer; jobs: JobLibrary }> {
  const computer = await newComputer();
  made.push(computer);
  const runtime = new FakeRuntime();
  const jobs = new JobLibrary(
    computer.store,
    computer.paths,
    { runtime, vault: new FakeVault(runtime) },
    computer.clock,
    computer.contracts,
  );
  return { computer, jobs };
}

function facts(job: Job, version: number, report: VersionFacts['report']): VersionFacts {
  const harness = harnessWith(job.name);
  return {
    agentId: 'grd_desk',
    name: job.name,
    version: 2,
    createdAt: '2026-11-06T09:00:00.000Z',
    method: 'architect',
    contract: JobContractSchema.parse({ ...contractTerms(job), version }),
    modelLabel: 'Glimmer',
    base: { name: 'muse-glimmer:30b' },
    contextLength: 16_384,
    runtime: 'ollama',
    harness: { meta: harness.meta, files: harnessToFiles(harness) },
    report,
    lineage: [],
    columns: {},
    rounds: 0,
    keptChanges: 0,
    testedHere: true,
  };
}

describe('job contracts', () => {
  it('get a new version when the scope or the bar changes, never for a new name', async () => {
    const { computer, jobs } = await setup();
    const job = await jobs.save(makeJob({ id: 'job_desk' }));
    const versions = () => computer.store.contracts.list('job_desk').map(({ version }) => version);
    expect(versions()).toEqual([1]);

    await jobs.save({ ...job, name: 'Front desk', summary: 'Answers the phone too.' });
    expect(versions()).toEqual([1]);

    const stricter = await jobs.save({ ...job, requirements: { passRate: 0.95 } });
    expect(versions()).toEqual([1, 2]);
    const wider = await jobs.save({
      ...stricter,
      taskTypes: [...stricter.taskTypes, { id: 'refund', label: 'Refunds' }],
    });
    expect(versions()).toEqual([1, 2, 3]);
    await jobs.save({ ...wider, permissions: { writes: 'never', unseenFiles: 'never' } });
    expect(versions()).toEqual([1, 2, 3, 4]);

    expect(computer.contracts.find(job)?.version).toBe(1);
    expect(computer.store.contracts.get('job_desk', 1)?.contract.acceptance.passRate).toBe(0.85);
    expect(computer.store.contracts.get('job_desk', 2)?.contract.acceptance.passRate).toBe(0.95);
  });

  it('never let a locked-test result carry over to another contract version', () => {
    const job = makeJob({ id: 'job_desk' });
    const measured = reportFor(job);
    const stricter: Job = { ...job, requirements: { passRate: 0.95 } };
    expect(() => buildPackage(facts(stricter, 2, measured))).toThrow(
      'A result never carries over to another contract.',
    );
    const narrower: Job = { ...job, taskTypes: [{ id: 'overdue', label: 'Overdue balances' }] };
    expect(() => buildPackage(facts(narrower, 2, measured))).toThrow('covered Invoices');

    const { draft } = buildPackage(facts(stricter, 2, null));
    expect(draft.evidence).toEqual({
      label: "Evaluated on the author's configuration",
      status: 'unevaluated',
      contractVersion: 2,
      counts: { testTasks: 0, rounds: 0, keptChanges: 0 },
    });
    expect(buildPackage(facts(job, 1, measured)).draft.evidence).toMatchObject({
      status: 'ready',
      contractVersion: 1,
      summary: { score: { pass: 17, total: 20 } },
    });
  });
});
