import { experimentWorld, importJobInto, type ExperimentWorld } from '@architect/engine/testing';
import {
  ExperimentDocSchema,
  ExperimentListDocSchema,
  ExperimentPlanDocSchema,
  ExperimentReportDocSchema,
  ExperimentStatusDocSchema,
} from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanUp, cli, testEnv, type Captured } from './support';

/*
 * `architect experiment` (decision 090) on the comparisons runner's fakes: no model is called and
 * nothing is spent. The commands go through the experiments API the app uses, so what the API
 * withholds before the tests are released stays withheld here.
 */

let env: NodeJS.ProcessEnv;
let world: ExperimentWorld;

beforeAll(async () => {
  env = await testEnv();
  await importJobInto(env['ARCHITECT_USER_DATA'] ?? '');
  world = experimentWorld();
}, 60_000);

afterAll(async () => {
  await world.close();
  await cleanUp();
});

const architect = (
  argv: string[],
  extra: { interruptWith?(press: () => void): void; onStderr?(text: string): void } = {},
): Promise<Captured> => cli(argv, { env, experimentEnvironment: world.environment, ...extra });

const PLAN = [
  'experiment',
  'plan',
  '--arms',
  'bare,draft',
  '--hypothesis',
  "Spark's one-shot draft passes more of the final test than the bare student.",
  '--primary',
  'draft-bare:all',
  '--seeds',
  '101,102',
  '--student-usd',
  '15',
  '--spark-usd',
  '10',
  '--wall-minutes',
  '600',
  '--json',
];

async function planned(extra: string[] = []): Promise<string> {
  const run = await architect([...PLAN.slice(0, 2), world.jobDir, ...PLAN.slice(2), ...extra]);
  expect(run.code, run.stderr).toBe(0);
  return ExperimentPlanDocSchema.parse(JSON.parse(run.stdout)).experiment.id;
}

describe('architect experiment plan', () => {
  it('turns its options into the plan the app would make', async () => {
    const run = await architect([...PLAN.slice(0, 2), world.jobDir, ...PLAN.slice(2)]);
    expect(run.code, run.stderr).toBe(0);
    const plan = ExperimentPlanDocSchema.parse(JSON.parse(run.stdout));
    expect(plan.experiment.status).toBe('draft');
    expect(plan.experiment.input).toMatchObject({
      arms: [{ arm: 'bare' }, { arm: 'draft' }],
      primaryComparison: { a: 'draft', b: 'bare', group: 'all' },
      seeds: { mentoring: 1, lockedTest: [101, 102] },
      rounds: 4,
      caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 600 },
    });
    expect(plan.projection.arms.map((arm) => arm.arm)).toEqual(['bare', 'draft']);
  });

  it('plans on a field in the library, by name, and says what comes next', async () => {
    const run = await architect([
      'experiment',
      'plan',
      'Academy desk',
      '--arms',
      'bare,reference-targeted',
      '--primary',
      'reference-targeted-bare:unseen',
    ]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain('Planned Academy desk');
    expect(run.stdout).toContain('Primary: reference-targeted less bare, on unseen');
    expect(run.stdout).toContain('Next: architect experiment preregister cmp_');
  });

  it('refuses bad input with exit 2', async () => {
    const field = world.jobDir;
    for (const argv of [
      ['experiment', 'plan', field],
      ['experiment', 'plan', field, '--arms', 'bare,nonsense'],
      ['experiment', 'plan', field, '--arms', 'bare,draft', '--primary', 'draft:all'],
      ['experiment', 'plan', field, '--arms', 'bare,draft', '--primary', 'draft-bare:never'],
      ['experiment', 'plan', field, '--arms', 'bare,draft', '--seeds', 'a,b'],
      ['experiment', 'plan', field, '--arms', 'bare,draft', '--student-usd', '-1'],
      ['experiment', 'plan', field, '--arms', 'bare,bare'],
      ['experiment', 'plan', 'nowhere', '--arms', 'bare'],
      ['experiment', 'status', 'cmp_missing'],
      ['experiment', 'explode'],
      ['experiment', 'start'],
    ]) {
      const run = await architect(argv);
      expect(run.code, argv.join(' ')).toBe(2);
      expect(run.stdout).toBe('');
    }
  });
});

describe('architect experiment, from plan to report', () => {
  it('refuses to preregister a plan without a hypothesis, with exit 3', async () => {
    const plain = await architect([
      'experiment',
      'plan',
      world.jobDir,
      '--arms',
      'bare,draft',
      '--json',
    ]);
    const { id } = ExperimentPlanDocSchema.parse(JSON.parse(plain.stdout)).experiment;
    const run = await architect(['experiment', 'preregister', id]);
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('State the hypothesis');
  });

  it('freezes, waits for the brief, runs, and releases results only at the end', async () => {
    const id = await planned();
    const frozen = await architect(['experiment', 'preregister', id, '--json']);
    expect(frozen.code, frozen.stderr).toBe(0);
    expect(
      ExperimentDocSchema.parse(JSON.parse(frozen.stdout)).experiment.preregistration,
    ).not.toBe(null);
    expect((await architect(['experiment', 'preregister', id])).code).toBe(3);

    // Spark's brief of the desks waits for the person: exit 3, and the token to confirm it.
    const waiting = await architect(['experiment', 'start', id]);
    expect(waiting.code, waiting.stderr).toBe(3);
    expect(waiting.stderr).toContain("Spark's brief");
    const token = /--confirm-study (\S+)/.exec(waiting.stderr)?.[1];
    expect(token).toBeDefined();

    // Before the release the status and the report hold nothing of the final test.
    const before = await architect(['experiment', 'status', id, '--json']);
    expect(before.code, before.stderr).toBe(0);
    const status = ExperimentStatusDocSchema.parse(JSON.parse(before.stdout));
    expect(status).toMatchObject({ released: false });
    expect(Object.keys(JSON.parse(before.stdout) as object)).toEqual([
      'format',
      'experiment',
      'released',
      'funding',
      'study',
      'arms',
      'totals',
    ]);
    const text = await architect(['experiment', 'status', id]);
    for (const shown of [before.stdout, text.stdout, waiting.stdout, waiting.stderr]) {
      for (const name of world.sealedNames) expect(shown).not.toContain(name);
      expect(shown).not.toContain('measuredOn');
    }
    const early = await architect(['experiment', 'report', id, '--json']);
    expect(early.code).toBe(4);
    expect(early.stdout).toBe('');
    expect(early.stderr).toContain('has no results yet');
    for (const name of world.sealedNames) expect(early.stderr).not.toContain(name);

    // Confirmed, it runs to the release.
    const done = await architect(['experiment', 'resume', id, '--confirm-study', token ?? '']);
    expect(done.code, done.stderr).toBe(0);
    expect(done.stderr).toContain(`architect experiment report ${id}`);

    const after = ExperimentStatusDocSchema.parse(
      JSON.parse((await architect(['experiment', 'status', id, '--json'])).stdout),
    );
    expect(after).toMatchObject({ released: true, experiment: { status: 'finished' } });

    const report = await architect(['experiment', 'report', id, '--json']);
    expect(report.code, report.stderr).toBe(0);
    const doc = ExperimentReportDocSchema.parse(JSON.parse(report.stdout));
    expect(doc.report.plan.releasedAt).not.toBeNull();
    expect(doc.report.backends.length).toBeGreaterThan(0);
    const markdown = await architect(['experiment', 'report', id]);
    expect(markdown.code, markdown.stderr).toBe(0);
    expect(markdown.stdout).toContain('# Comparisons');

    const listed = await architect(['experiment', 'list', '--json']);
    const all = ExperimentListDocSchema.parse(JSON.parse(listed.stdout)).experiments;
    expect(all.find((item) => item.id === id)?.status).toBe('finished');
    expect((await architect(['experiment', 'list'])).stdout).toContain(id);

    // Nothing to pause or resume once it ended; stopping it changes nothing.
    const pause = await architect(['experiment', 'pause', id]);
    expect(pause.code).toBe(3);
    expect(pause.stderr).toContain('press Ctrl+C there');
    expect((await architect(['experiment', 'resume', id])).code).toBe(3);
    expect((await architect(['experiment', 'stop', id])).code).toBe(0);
  }, 120_000);

  it('pauses on Ctrl+C and says how to go on', async () => {
    const id = await planned(['--name', 'Interrupted']);
    await architect(['experiment', 'preregister', id]);
    const waiting = await architect(['experiment', 'start', id]);
    const token = /--confirm-study (\S+)/.exec(waiting.stderr)?.[1] ?? '';
    let press = () => {};
    const stopped = await architect(['experiment', 'resume', id, '--confirm-study', token], {
      interruptWith: (fn) => (press = fn),
      onStderr: (text) => {
        if (text.includes('Running')) press();
      },
    });
    expect(stopped.code, stopped.stderr).toBe(130);
    expect(stopped.stderr).toContain(`architect experiment resume ${id}`);
    const status = ExperimentStatusDocSchema.parse(
      JSON.parse((await architect(['experiment', 'status', id, '--json'])).stdout),
    );
    expect(status.experiment.status).toBe('paused');
    expect(status.released).toBe(false);

    expect((await architect(['experiment', 'stop', id])).code).toBe(0);
    const ended = await architect(['experiment', 'resume', id]);
    expect(ended.code).toBe(3);
  }, 120_000);
});
