import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { splitTasks } from '@architect/engine';
import { describe, expect, it } from 'vitest';
import { GROUP_SEEDS, buildGroup, buildJobFiles, generateJob, jobDir } from '../src';
import { SWEEPS } from '../src/group/build';
import { COLUMNS } from '../src/group/files';
import { T_975, diverged } from '../src/group/rules';
import { GROUPS } from '../src/group/style';
import { HEADER_DATE } from '../src/job-file';
import { csvColumns } from '../src/lib/csv';
import { readPolicy } from '../src/reference/policy';
import { SKILLS } from '../src/tasks/build';
import { job } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

const generated = buildJobFiles();
const groups = generated.groups;

describe('generating the job', () => {
  it('gives identical bytes for the same seeds', () => {
    const again = buildJobFiles();
    expect([...again.files.keys()]).toEqual([...generated.files.keys()]);
    for (const [path, text] of generated.files) expect(again.files.get(path), path).toBe(text);
  });

  it('matches the committed job folder byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'sweep-desk-'));
    try {
      await generateJob(outDir);
      const written = await filesUnder(outDir);
      expect(await filesUnder(jobDir)).toEqual(written);
      for (const path of written) {
        const fresh = await readFile(join(outDir, path), 'utf8');
        expect(await readFile(join(jobDir, path), 'utf8'), path).toBe(fresh);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it('builds another group from another seed', () => {
    const other = buildGroup(GROUPS[0]!, 7);
    expect(other.tasks).toHaveLength(SKILLS.length * SWEEPS);
    expect(other.files.get('metrics.csv')).not.toBe(groups[0]!.files.get('metrics.csv'));
  });
});

describe('the groups', () => {
  const organizations = job.job().organizations ?? [];

  it('are three groups taught on and one never seen, all synthetic', () => {
    expect(organizations.map((org) => org.role)).toEqual(GROUP_SEEDS.map((s) => s.role));
    expect(organizations.filter((org) => org.role === 'transfer')).toHaveLength(1);
    expect(organizations.every((org) => org.synthetic)).toBe(true);
    expect(new Set(organizations.map((org) => org.id)).size).toBe(4);
    expect(new Set(organizations.map((org) => org.name)).size).toBe(4);
    expect(job.job().organizationNoun).toBe('group');
  });

  it('each have the job files, in the documented columns, and configs.json only if they use it', async () => {
    const declared = job.job().data.files.map((file) => file.name);
    for (const { group } of groups) {
      const { style } = group;
      const names = await filesUnder(job.dataDir(style.id));
      const expected = [
        'policy.md',
        ...Object.keys(COLUMNS),
        ...(style.configs === 'json' ? ['configs.json'] : []),
      ];
      expect(names, style.id).toEqual(expected.sort());
      expect(names.every((name) => declared.includes(name))).toBe(true);
      for (const [name, columns] of Object.entries(COLUMNS)) {
        const want = typeof columns === 'function' ? columns(style) : columns;
        expect(
          csvColumns(job.file(`orgs/${style.id}/data/${name}`)),
          `${style.id} ${name}`,
        ).toEqual(want);
      }
    }
  });

  it('differ in metric names, logging, knob names, config layout and policy', () => {
    const styles = groups.map((g) => g.group.style);
    expect(new Set(styles.map((s) => `${s.metrics.train} ${s.metrics.val}`)).size).toBe(4);
    expect(new Set(styles.map((s) => s.axis))).toEqual(new Set(['step', 'epoch']));
    expect(new Set(styles.map((s) => s.fields.lr)).size).toBe(2);
    expect(new Set(styles.map((s) => s.configs))).toEqual(new Set(['columns', 'json']));
    expect(new Set(styles.map((s) => s.policyStyle))).toEqual(new Set(['table', 'prose']));
    const taught = styles.filter((s) => s.id !== 'fennick');
    // The groups taught on use every kind of rule between them.
    expect(new Set(taught.map((s) => s.policy.score.kind))).toEqual(new Set(['last', 'min']));
    expect(new Set(taught.map((s) => s.policy.divergedSeeds))).toEqual(
      new Set(['drop', 'exclude']),
    );
    expect(new Set(taught.map((s) => s.policy.interval))).toEqual(new Set(['t', 'se2', 'range']));
    // The group never seen has numbers no taught group uses.
    const unseen = styles.find((s) => s.id === 'fennick')!.policy;
    for (const s of taught) {
      expect(s.policy.factor).not.toBe(unseen.factor);
      expect(s.policy.patience).not.toBe(unseen.patience);
      expect(s.policy.seeds).not.toEqual(unseen.seeds);
    }
  });

  it('state their rules in policy.md, where the reference reads them back', () => {
    for (const { group, files } of groups) {
      const { style } = group;
      const t =
        style.policyStyle === 'table' || style.policy.interval === 't' ? T_975.slice(0, 5) : [];
      expect(readPolicy(files.get('policy.md')!), style.id).toEqual({
        ...style.policy,
        metrics: style.metrics,
        t,
      });
    }
  });

  it('each have a date of their own, which every request states and the records end by', () => {
    expect(job.job().businessDate).toBe(HEADER_DATE);
    const dates = groups.map((g) => g.group.style.today);
    expect(new Set(dates).size).toBe(4);
    expect(dates).not.toContain(HEADER_DATE);
    for (const { group, tasks } of groups) {
      const { today } = group.style;
      const long = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      for (const task of tasks) expect(task.prompt.startsWith(`It's ${long}.`), task.id).toBe(true);
      const recorded = [
        ...group.sweeps.map((s) => s.started_on),
        ...group.proposals.map((p) => p.proposed_on),
        ...group.decisions.map((d) => d.decided_on),
      ];
      expect(
        recorded.every((date) => date < today),
        group.style.id,
      ).toBe(true);
    }
  });
});

describe('the records', () => {
  const runs = groups.flatMap((g) => g.group.sweeps.flatMap((s) => s.runs));

  it('have runs that diverged in every way the policy names, and statuses that do not say so', () => {
    for (const { group } of groups) {
      const { policy, statuses } = group.style;
      const all = group.sweeps.flatMap((s) => s.runs);
      const bad = all.filter((run) => diverged(run, policy));
      expect(bad.length, group.style.id).toBeGreaterThan(5);
      // Some only by the factor: every loss a number, one of them too high.
      expect(
        bad.some((run) => run.evals.every((e) => Number.isFinite(e.train))),
        group.style.id,
      ).toBe(true);
      // Some the scheduler marked as finished.
      expect(
        bad.some((run) => statuses.ok.includes(run.status)),
        group.style.id,
      ).toBe(true);
    }
    expect(
      runs.filter((run) => run.evals.some((e) => Number.isNaN(e.train))).length,
    ).toBeGreaterThan(5);
    expect(
      runs.filter((run) => run.evals.some((e) => e.train === Infinity)).length,
    ).toBeGreaterThan(5);
  });

  it('give every config the policy seeds, but now and then miss one', () => {
    for (const { group } of groups) {
      for (const sweep of group.sweeps) {
        for (const run of sweep.runs) expect(group.style.policy.seeds).toContain(run.seed);
      }
    }
    const missing = groups.some(({ group }) =>
      group.sweeps.some((s) => s.runs.length % group.style.policy.seeds.length !== 0),
    );
    expect(missing).toBe(true);
  });
});

describe('the tasks', () => {
  it('are 48 per group, one of each skill per sweep, with unique ids and a family per sweep', () => {
    const tasks = job.allTasks();
    expect(tasks).toHaveLength(192);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(192);
    for (const org of job.orgs()) {
      const own = tasks.filter((t) => t.org === org);
      expect(own).toHaveLength(48);
      for (const skill of SKILLS) expect(own.filter((t) => t.type === skill)).toHaveLength(SWEEPS);
      const families = new Set(own.map((t) => t.family));
      expect(families.size).toBe(SWEEPS);
      for (const family of families) {
        expect(family.startsWith(`${org}:`)).toBe(true);
        expect(
          own
            .filter((t) => t.family === family)
            .map((t) => t.type)
            .sort(),
        ).toEqual([...SKILLS].sort());
      }
    }
  });

  it("split the taught groups' tasks into the sizes the job asks for, each family in one split", () => {
    const config = job.job().splits;
    const taught = new Set(
      (job.job().organizations ?? []).filter((o) => o.role === 'train').map((o) => o.id),
    );
    const tasks = job.allTasks().filter((t) => taught.has(t.org!));
    const splits = splitTasks(tasks, config);
    expect(splits.calibration).toHaveLength(config.calibration);
    expect(splits.train).toHaveLength(config.train);
    expect(splits.dev).toHaveLength(config.dev);
    expect(splits.test).toHaveLength(config.test);
    const where = new Map<string, string>();
    for (const [name, list] of Object.entries(splits)) {
      for (const task of list as typeof tasks) {
        const seen = where.get(task.family);
        expect(seen === undefined || seen === name, task.family).toBe(true);
        where.set(task.family, name);
      }
    }
  });

  it('ask about clear cases: a best config ahead of the next and verdicts no rounding flips', () => {
    for (const task of job.allTasks()) {
      if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no end state`);
      const params = task.expected.params as Record<string, number>;
      if (task.type === 'did_it_help' || task.type === 'sweep_report') {
        expect(Math.min(Math.abs(params.low!), Math.abs(params.high!)), task.id).toBeGreaterThan(
          0.0015,
        );
      }
    }
  });
});
