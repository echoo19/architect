import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, splitTasks } from '@architect/engine';
import type { LeakDetector } from '@architect/engine';
import type { Task } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildJobFiles } from '../src';
import { earlyStop } from '../src/group/rules';
import { allAttempts } from './attempts';
import { job } from './helpers';

/**
 * The job sealed the way the runner seals it: the final test (the taught groups' share and every
 * Fennick task) in a vault, fingerprinted against the other splits and the taught groups' files.
 * Nothing a practice, check or calibration task holds, and nothing an attempt at one would say
 * about its own sweep, may match a sealed task: the vault's leak check would refuse the mentor
 * call that carried it, as it did in the job's first run.
 */

const generated = buildJobFiles();

interface Sealed {
  detector: LeakDetector;
  /** Every task outside the final test: calibration, practice and check tasks. */
  open: Task[];
}

/** Seals the committed job in a vault under `root` and returns its leak detector. */
function sealJob(root: string): Sealed {
  const spec = job.job();
  const sealedOrgs = (spec.organizations ?? []).filter((org) => org.role === 'transfer');
  const isSealed = (task: Task) => sealedOrgs.some((org) => org.id === task.org);
  const tasks = job.allTasks();
  const trained = tasks.filter((task) => !isSealed(task));
  const splits = splitTasks(trained, spec.splits);
  const tests = new Set(splits.test.map((task) => task.id));
  const open = trained.filter((task) => !tests.has(task.id));
  // The taught groups' files as text; the runner also leaves out their rows as JSON, so this
  // fingerprint keeps a little more than the runner's and is the stricter of the two.
  const data = job
    .orgs()
    .filter((org) => !sealedOrgs.some((sealed) => sealed.id === org))
    .flatMap((org) => [...job.data(org).values()]);
  const transfer = sealedOrgs.map((org) => ({
    org,
    files: [...job.data(org.id)].map(([name, content]) => ({ name, content })),
  }));
  const vault = new Vault(root);
  vault.seal(spec.id, [...splits.test, ...tasks.filter(isSealed)], open, data, transfer);
  return { detector: vault.leakDetector(spec.id), open };
}

/** Each text that matches a sealed task, by its label and how many it matches. */
function leaks(detector: LeakDetector, texts: readonly [string, string][]): string[] {
  return texts.flatMap(([label, text]) => {
    const { matchedIds } = detector.scan(text);
    return matchedIds.length === 0 ? [] : [`${label}: ${matchedIds.length} sealed tasks`];
  });
}

describe("the vault's leak check on the job's splits", () => {
  let root: string;
  let sealed: Sealed;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sweep-desk-vault-'));
    sealed = sealJob(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds no sealed task in any other task, its request or its expected result', () => {
    const texts = sealed.open.map((task): [string, string] => [
      task.id,
      `${task.prompt}\n${JSON.stringify(task.expected)}`,
    ]);
    expect(leaks(sealed.detector, texts)).toEqual([]);
  });

  it("finds none in the reference solutions' calls, results and answers on the other tasks", () => {
    const open = new Set(sealed.open.map((task) => task.id));
    const texts = allAttempts()
      .filter(({ task }) => open.has(task.id))
      .map(({ task, tools, answer }): [string, string] => [
        task.id,
        [
          ...tools.calls.flatMap((call) => [JSON.stringify(call.arguments), call.content]),
          `ANSWER: ${JSON.stringify(answer)}`,
        ].join('\n'),
      ]);
    expect(texts).toHaveLength(sealed.open.length);
    expect(leaks(sealed.detector, texts)).toEqual([]);
  });

  it("finds none in an open sweep's configs, grid or early stops, listed the way a tool lists them", () => {
    const families = new Set(sealed.open.map((task) => task.family));
    const texts = generated.groups.flatMap(({ group }) =>
      group.sweeps
        .filter((sweep) => families.has(`${group.style.id}:${sweep.sweep_id}`))
        .flatMap((sweep): [string, string][] => {
          const label = `${group.style.id} ${sweep.sweep_id}`;
          const configs = sweep.grid.lr.flatMap((lr) =>
            sweep.grid.warmup.map((warmup) => ({ lr, warmup })),
          );
          const unit = group.style.axis;
          const stops = sweep.runs.map((run) => earlyStop(run, group.style.policy));
          return [
            [
              `${label} configs`,
              JSON.stringify(configs.flatMap((a) => configs.flatMap((b) => [a, b]))),
            ],
            [`${label} grid`, JSON.stringify(sweep.grid)],
            [`${label} early stops`, JSON.stringify(stops.map((stop) => ({ ...stop, unit })))],
            [`${label} early stops`, JSON.stringify(stops.map((stop) => ({ unit, ...stop })))],
          ];
        }),
    );
    expect(texts.length).toBeGreaterThan(0);
    expect(leaks(sealed.detector, texts)).toEqual([]);
  });
});
