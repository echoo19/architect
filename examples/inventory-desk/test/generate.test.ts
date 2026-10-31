import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';
import {
  jobDir as assayJobDir,
  csvColumns,
  parseCsv,
  writeDate,
} from '@architect/example-assay-desk';
import { splitTasks } from '@architect/engine';
import { JobSchema, TaskSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { LAB_SEEDS, buildJobFiles, buildLab, generateJob, jobDir } from '../src';
import { COLUMNS, PLAIN_ROWS } from '../src/lab/files';
import { POLICY_STYLES, policyDocument } from '../src/lab/policy';
import { usableLots, usableVolume } from '../src/lab/stock';
import { TODAY } from '../src/job-file';
import { helpers } from '../src/reference/code';
import { readPolicy } from '../src/reference/policy';
import { PER_SKILL, SKILLS } from '../src/tasks/build';
import { job, paramsOf, todayOf } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

const generated = buildJobFiles();
const labs = generated.labs;

/** The Assay desk's committed job, read as files: the labs this one serves. */
const assay = {
  file: (path: string) => readFileSync(join(assayJobDir, ...path.split('/')), 'utf8'),
  job: () => JobSchema.parse(JSON.parse(assay.file('job.json'))),
  tasks: () =>
    assay
      .file('tasks.jsonl')
      .trimEnd()
      .split('\n')
      .map((line) => TaskSchema.parse(JSON.parse(line))),
};

/** The reference's own readers (the code it sends to `run`), to read every written value back. */
const readers = (() => {
  const context = vm.createContext({});
  vm.runInContext(
    `${helpers(labs[0]!.desk.style.policy, TODAY)}\nthis.readers = { key, nl, dayOf };`,
    context,
  );
  return (context as unknown as { readers: Readers }).readers;
})();
interface Readers {
  key(value: string): string;
  nl(value: string): number;
  dayOf(value: string): string;
}

describe('generating the job', () => {
  it('gives identical bytes for the same seeds', () => {
    const again = buildJobFiles();
    expect([...again.files.keys()]).toEqual([...generated.files.keys()]);
    for (const [path, text] of generated.files) expect(again.files.get(path), path).toBe(text);
  });

  it('matches the committed job folder byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'inventory-desk-'));
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

  it('builds another lab from another seed', () => {
    const other = buildLab(7);
    expect(other.tasks).toHaveLength(SKILLS.length * PER_SKILL);
    expect(other.files.get('inventory.csv')).not.toBe(labs[0]!.files.get('inventory.csv'));
  });
});

describe('the labs', () => {
  const organizations = job.job().organizations ?? [];

  it("are the Assay desk's labs, with the same names and roles", () => {
    expect(organizations).toEqual(assay.job().organizations);
    expect(organizations.map((org) => org.id)).toEqual(LAB_SEEDS.map((s) => s.style.id));
    expect(organizations.filter((org) => org.role === 'transfer')).toHaveLength(1);
  });

  it("hold every compound on the Assay desk's plates", () => {
    for (const { organization, desk } of labs) {
      const held = new Set(desk.store.lots.map((lot) => lot.compound));
      const rows = parseCsv(assay.file(`orgs/${organization.id}/data/compounds.csv`));
      const policy = assay.file(`orgs/${organization.id}/data/policy.md`);
      const ids = new Set(rows.map((row) => row.compound_id!.trim().toUpperCase()));
      const compounds = [...ids].filter((id) => !new RegExp(`\\b${id}\\b`).test(policy));
      expect(compounds.length, organization.id).toBe(desk.assay.compounds.length);
      for (const id of compounds) expect(held.has(id), `${organization.id} ${id}`).toBe(true);
    }
  });

  it("each have the job's files, in the documented columns", async () => {
    for (const { organization } of labs) {
      const names = await filesUnder(job.dataDir(organization.id));
      expect(names).toEqual(['inventory.csv', 'policy.md', 'reservations.csv']);
      for (const [name, columns] of Object.entries(COLUMNS)) {
        expect(csvColumns(job.file(`orgs/${organization.id}/data/${name}`))).toEqual(columns);
      }
    }
  });

  it('differ in their rules, and the lab never seen has numbers no taught lab uses', () => {
    const policies = labs.map((l) => l.desk.style.policy);
    for (const field of ['minimum', 'cutoff', 'maxHolds'] as const) {
      expect(new Set(policies.map((p) => p[field])).size, field).toBe(4);
    }
    expect(new Set(policies.map((p) => p.codes.limit)).size).toBe(4);
    const taught = policies.slice(0, 3);
    expect(new Set(taught.map((p) => p.unit))).toEqual(new Set(['uL', 'mL', 'nL']));
    expect(new Set(taught.map((p) => p.dateForm))).toEqual(new Set(['iso', 'us', 'dmy']));
    expect(new Set(taught.map((p) => p.choose))).toEqual(new Set(['expiry', 'largest']));
    expect(new Set(taught.map((p) => p.combine))).toEqual(new Set([true, false]));
    const transfer = policies[3]!;
    expect(taught.some((p) => p.choose === transfer.choose && p.combine === transfer.combine)).toBe(
      false,
    );
    expect(new Set(labs.slice(0, 3).map((l) => l.desk.style.policyStyle))).toEqual(
      new Set(POLICY_STYLES),
    );
  });

  it("each work on the Assay desk's day for the lab, which every request states", () => {
    const days = new Map(
      assay.tasks().map((task) => [task.org!, /^It's [^.]+\./.exec(task.prompt)![0]]),
    );
    for (const { desk, tasks, organization } of labs) {
      expect(desk.assay.today).not.toBe(TODAY);
      for (const task of tasks) {
        expect(todayOf(task), task.id).toBe(desk.assay.today);
        expect(task.prompt.startsWith(days.get(organization.id)!), task.id).toBe(true);
      }
      for (const hold of desk.store.holds) expect(hold.reservedOn < desk.assay.today).toBe(true);
      for (const lot of desk.store.lots) expect(lot.received < desk.assay.today).toBe(true);
    }
  });
});

describe('the policy', () => {
  it("reads back to the lab's rules from policy.md", () => {
    for (const { files, desk } of labs) {
      expect(readPolicy(files.get('policy.md')!), desk.assay.id).toEqual(desk.style.policy);
    }
  });

  it('reads back the same in every style, for every lab', () => {
    for (const { desk } of labs) {
      for (const style of POLICY_STYLES) {
        const text = policyDocument(desk.assay.name, desk.assay.today, desk.style.policy, style);
        expect(readPolicy(text), `${desk.assay.id} ${style}`).toEqual(desk.style.policy);
      }
    }
  });
});

describe('the files', () => {
  it("read back to every lot's true volume and dates, whatever unit a row is written in", () => {
    for (const { desk, files } of labs) {
      const { policy, lots } = desk.store;
      const rows = parseCsv(files.get('inventory.csv')!);
      expect(rows).toHaveLength(lots.length);
      const other = rows.map((row, i) => {
        const lot = lots[i]!;
        expect(row.lot).toBe(lot.lot);
        expect(readers.nl(row.quantity!), lot.lot).toBe(lot.quantity);
        expect(row.expires).toBe(writeDate(lot.expires, policy.dateForm));
        expect(readers.dayOf(row.expires!)).toBe(lot.expires);
        expect(readers.dayOf(row.received!)).toBe(lot.received);
        return !row.quantity!.endsWith({ uL: 'µL', mL: 'mL', nL: 'nL' }[policy.unit]);
      });
      const share = other.filter(Boolean).length / other.length;
      expect(share, desk.assay.id).toBeGreaterThan(0.08);
      expect(share).toBeLessThan(0.25);
      expect(other.slice(0, PLAIN_ROWS).some(Boolean)).toBe(false);
    }
  });

  it('hold reservations within what each lot has, and a few compounds at the limit', () => {
    for (const { desk } of labs) {
      const { lots, holds, policy } = desk.store;
      for (const lot of lots) {
        const held = holds.filter((h) => h.lot === lot.lot).reduce((s, h) => s + h.amount, 0);
        expect(held, lot.lot).toBeLessThanOrEqual(lot.quantity);
      }
      const perCompound = new Map<string, number>();
      for (const h of holds) perCompound.set(h.compound, (perCompound.get(h.compound) ?? 0) + 1);
      const atLimit = [...perCompound.values()].filter((n) => n >= policy.maxHolds);
      expect(atLimit.length, desk.assay.id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the tasks', () => {
  it(`are ${PER_SKILL} of each skill at every lab, with ids unique across the job`, () => {
    for (const { tasks, organization } of labs) {
      for (const skill of SKILLS) {
        expect(
          tasks.filter((t) => t.type === skill),
          `${organization.id} ${skill}`,
        ).toHaveLength(PER_SKILL);
      }
      expect(tasks.every((t) => t.org === organization.id)).toBe(true);
      expect(tasks.every((t) => t.family.startsWith(`${organization.id}:`))).toBe(true);
    }
    expect(new Set(generated.tasks.map((t) => t.id)).size).toBe(generated.tasks.length);
  });

  it('split into the sizes the job asks for, with every family in one split', () => {
    const { splits, organizations } = job.job();
    const transfer = new Set(
      (organizations ?? []).filter((o) => o.role === 'transfer').map((o) => o.id),
    );
    const taught = job.allTasks().filter((t) => !transfer.has(t.org!));
    const split = splitTasks(taught, splits);
    expect(split.unused).toHaveLength(0);
    const sizes = (['calibration', 'train', 'dev', 'test'] as const).map((n) => split[n].length);
    expect(sizes).toEqual([splits.calibration, splits.train, splits.dev, splits.test]);
    const where = new Map<string, string>();
    for (const name of ['calibration', 'train', 'dev', 'test'] as const) {
      for (const task of split[name]) {
        expect(where.get(task.family) ?? name, task.family).toBe(name);
        where.set(task.family, name);
      }
    }
  });

  it('cover the hard cases at every lab', () => {
    for (const { desk, tasks } of labs) {
      const { store } = desk;
      const asked = (type: string) =>
        tasks
          .filter((t) => t.type === type)
          .map((t) => (t.meta!.request as { compound: string }).compound);
      const usable = asked('usable');
      expect(
        usable.some((c) => usableVolume(store, c) === 0),
        `${desk.assay.id} none usable`,
      ).toBe(true);
      const first = (c: string, choose: 'expiry' | 'largest') =>
        usableLots({ ...store, policy: { ...store.policy, choose } }, c)[0]?.lot;
      expect(
        asked('pick_lot').some((c) => first(c, 'expiry') !== first(c, 'largest')),
        `${desk.assay.id} first to expire is not the largest`,
      ).toBe(true);
      const lists = tasks.filter((t) => t.type === 'allocate' || t.type === 'reserve');
      const short = lists.filter((t) =>
        (paramsOf(t).allocations as { reason: string | null }[]).some((a) => a.reason !== null),
      );
      expect(short.length * 2, desk.assay.id).toBeGreaterThan(lists.length);
    }
  });

  it("take their lists of compounds from the Assay desk's re-test candidates", () => {
    const candidates = new Map<string, string[]>();
    for (const task of assay.tasks().filter((t) => t.type === 'plate_report')) {
      const plan = (
        paramsOf(task).retests as {
          plates: { plate: string; candidates: { compound: string }[] }[];
        }
      ).plates[0]!;
      candidates.set(
        plan.plate,
        plan.candidates.map((c) => c.compound),
      );
    }
    for (const task of job
      .allTasks()
      .filter((t) => t.type === 'allocate' || t.type === 'reserve')) {
      const { plate, compounds } = task.meta!.request as { plate: string; compounds: string[] };
      for (const c of compounds) expect(candidates.get(plate), task.id).toContain(c);
    }
  });
});

describe('the demo with the Assay desk', () => {
  it('passes on a list the Assay desk queues whole, as its own tasks expect', () => {
    for (const { desk, tasks } of labs) {
      const { list, short } = desk.chain;
      const report = assay
        .tasks()
        .find((t) => t.type === 'plate_report' && paramsOf(t).plate === list.plate)!;
      const retests = paramsOf(report).retests as {
        plates: { candidates: { compound: string }[]; take: number }[];
      };
      const plan = retests.plates[0]!;
      expect(plan.candidates.map((c) => c.compound)).toEqual(list.compounds);
      expect(plan.take).toBe(list.compounds.length);
      for (const type of ['allocate', 'reserve']) {
        const first = tasks.find((t) => t.type === type)!;
        expect((first.meta!.request as { compounds: string[] }).compounds).toEqual(list.compounds);
        const allocations = paramsOf(first).allocations as {
          compound: string;
          reason: string | null;
        }[];
        expect(allocations.find((a) => a.compound === short)!.reason).not.toBeNull();
        expect(
          allocations.some((a) => a.reason === null),
          first.id,
        ).toBe(true);
      }
    }
  });

  it("is written up in the README with Fenwick's true values", () => {
    const readme = readFileSync(join(jobDir, '..', 'README.md'), 'utf8');
    const fenwick = labs.find((l) => l.organization.id === 'fenwick')!;
    const reserve = fenwick.tasks.find((t) => t.type === 'reserve')!;
    const params = paramsOf(reserve) as {
      allocations: {
        compound: string;
        draws: { lot: string; location: string; amount_ul: number }[];
        reason: string | null;
      }[];
      ids: string[];
    };
    expect(readme).toContain(fenwick.desk.chain.list.plate);
    for (const a of params.allocations) {
      expect(readme).toContain(a.compound);
      if (a.reason !== null) expect(readme).toContain(a.reason);
      for (const d of a.draws) {
        expect(readme).toContain(d.lot);
        expect(readme).toContain(d.location);
      }
    }
    for (const id of params.ids) expect(readme).toContain(id);
  });
});
