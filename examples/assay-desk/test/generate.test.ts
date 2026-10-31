import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';
import { splitTasks } from '@architect/engine';
import { describe, expect, it } from 'vitest';
import { LAB_SEEDS, buildJobFiles, buildLab, generateJob, jobDir } from '../src';
import { COLUMNS, EXPORTS, NO_READING, PLAIN_ROWS, writeDate, writeWell } from '../src/lab/files';
import { POLICY_STYLES, policyDocument } from '../src/lab/policy';
import { TODAY } from '../src/job-file';
import { csvColumns, parseCsv } from '../src/lib/csv';
import { helpers } from '../src/reference/code';
import { readPolicy } from '../src/reference/policy';
import { PER_SKILL, SKILLS } from '../src/tasks/build';
import { job, todayOf } from './helpers';

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

const generated = buildJobFiles();
const labs = generated.labs;

/**
 * The reference's own readers (the code it sends to `run`), to check that every value an export
 * writes another way reads back to the one true value.
 */
const readers = (() => {
  const context = vm.createContext({});
  vm.runInContext(
    `${helpers(labs[0]!.lab.style.policy)}\nthis.readers = { key, wellOf, reading, dayOf };`,
    context,
  );
  return (context as unknown as { readers: Readers }).readers;
})();
interface Readers {
  key(value: string): string;
  wellOf(value: string): string | null;
  reading(value: string): number | null;
  dayOf(value: string): string | null;
}

describe('generating the job', () => {
  it('gives identical bytes for the same seeds', () => {
    const again = buildJobFiles();
    expect([...again.files.keys()]).toEqual([...generated.files.keys()]);
    for (const [path, text] of generated.files) expect(again.files.get(path), path).toBe(text);
  });

  it('matches the committed job folder byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'assay-desk-'));
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
    expect(other.files.get('compounds.csv')).not.toBe(labs[0]!.files.get('compounds.csv'));
  });
});

describe('the labs', () => {
  const organizations = job.job().organizations ?? [];

  it('are three labs to teach on and one never seen, all synthetic', () => {
    expect(organizations.map((org) => org.role)).toEqual(LAB_SEEDS.map((s) => s.role));
    expect(organizations.filter((org) => org.role === 'transfer')).toHaveLength(1);
    expect(organizations.every((org) => org.synthetic)).toBe(true);
    expect(new Set(organizations.map((org) => org.name)).size).toBe(4);
  });

  it("each have the job's files, in the documented columns, and an export per instrument", async () => {
    const declared = new Set(job.job().data.files.map((file) => file.name));
    for (const { organization, lab } of labs) {
      const names = await filesUnder(job.dataDir(organization.id));
      for (const name of names) expect(declared.has(name), `${organization.id} ${name}`).toBe(true);
      const exports = lab.style.instruments.map((i) => EXPORTS[i].file);
      expect(names).toEqual(['policy.md', ...Object.keys(COLUMNS), ...exports].sort());
      for (const [name, columns] of Object.entries(COLUMNS)) {
        expect(csvColumns(job.file(`orgs/${organization.id}/data/${name}`))).toEqual(columns);
      }
      for (const instrument of lab.style.instruments) {
        const { file, columns } = EXPORTS[instrument];
        expect(csvColumns(job.file(`orgs/${organization.id}/data/${file}`))).toEqual(columns);
      }
    }
  });

  it('read 96- and 384-well plates, with plates that pass, fail and sit near the line', () => {
    for (const { lab } of labs) {
      const { zMin } = lab.style.policy;
      const zs = lab.plates.map((p) => p.calls.stats.zPrime);
      expect(new Set(lab.plates.map((p) => p.layout))).toEqual(new Set([96, 384]));
      expect(zs.filter((z) => z < zMin).length, lab.style.id).toBeGreaterThanOrEqual(2);
      expect(
        zs.some((z) => z >= zMin && z < zMin + 0.05),
        lab.style.id,
      ).toBe(true);
      expect(
        zs.some((z) => z < zMin && z > zMin - 0.06),
        lab.style.id,
      ).toBe(true);
    }
  });

  it('differ in their rules, and the lab never seen has numbers no taught lab uses', () => {
    const policies = labs.map((l) => l.lab.style.policy);
    for (const field of ['zMin', 'band', 'agree', 'cap'] as const) {
      expect(new Set(policies.map((p) => p[field])).size, field).toBe(4);
    }
    expect(new Set(policies.map((p) => p.neg)).size).toBe(4);
    expect(new Set(policies.map((p) => p.codes.qc)).size).toBe(4);
    const transfer = policies[3]!;
    const taught = policies.slice(0, 3);
    expect(taught.some((p) => JSON.stringify(p.hit) === JSON.stringify(transfer.hit))).toBe(false);
    expect(new Set(taught.map((p) => p.hit.kind))).toEqual(new Set(['percent', 'sd']));
    expect(new Set(taught.map((p) => p.rule))).toEqual(new Set(['mean', 'all']));
    expect(new Set(labs.slice(0, 3).map((l) => l.lab.style.policyStyle))).toEqual(
      new Set(POLICY_STYLES),
    );
  });

  it('each have their own date, which every request states and no record passes', () => {
    for (const { lab, tasks } of labs) {
      expect(lab.style.today).not.toBe(TODAY);
      for (const task of tasks) expect(todayOf(task), task.id).toBe(lab.style.today);
      for (const plate of lab.plates) expect(plate.readOn < lab.style.today).toBe(true);
      for (const row of lab.queue) expect(row.requestedOn < lab.style.today).toBe(true);
    }
  });
});

describe('the policy', () => {
  it("reads back to the lab's rules from policy.md", () => {
    for (const { files, lab } of labs) {
      expect(readPolicy(files.get('policy.md')!), lab.style.id).toEqual(lab.style.policy);
    }
  });

  it('reads back the same in every style, for every lab', () => {
    for (const { lab } of labs) {
      for (const style of POLICY_STYLES) {
        const text = policyDocument(lab.style.name, lab.style.policy, style);
        expect(readPolicy(text), `${lab.style.id} ${style}`).toEqual(lab.style.policy);
      }
    }
  });
});

describe('the exports', () => {
  /** Share of a table's rows written another way, and whether any is in the first rows. */
  function otherShare(flags: readonly boolean[]) {
    return {
      share: flags.filter(Boolean).length / flags.length,
      early: flags.slice(0, PLAIN_ROWS).some(Boolean),
    };
  }

  it("read back to every well's true signal, whatever the instrument wrote", () => {
    for (const { lab, files } of labs) {
      for (const instrument of lab.style.instruments) {
        const rows = parseCsv(files.get(EXPORTS[instrument].file)!);
        const plates = lab.plates.filter((p) => p.instrument === instrument);
        const marks = NO_READING[instrument];
        let missing = 0;
        let at = 0;
        for (const plate of plates) {
          const truth = new Map(plate.wells.map((w) => [w.well, w.signal]));
          const own = rows.slice(at, at + plate.wells.length);
          at += plate.wells.length;
          for (const row of own) {
            const cells = Object.values(row).map((v) => v ?? '');
            expect(readers.key(cells[0]!)).toBe(readers.key(plate.id));
            const well = readers.wellOf(cells.length === 4 ? cells[1]! + cells[2]! : cells[1]!)!;
            const value = cells[cells.length - 1]!;
            expect(readers.reading(value), `${plate.id} ${well} ${value}`).toBe(truth.get(well));
            if (truth.get(well) === null) {
              missing += 1;
              expect([marks.overflow, marks.blank]).toContain(value);
            }
          }
        }
        expect(at).toBe(rows.length);
        expect(missing, `${lab.style.id} ${instrument}`).toBeGreaterThan(0);
      }
    }
  });

  it('write 10 to 30 percent of readings another way, none in the first rows', () => {
    for (const { lab, files } of labs) {
      for (const instrument of ['lumen', 'orbit'] as const) {
        if (!lab.style.instruments.includes(instrument)) continue;
        const rows = parseCsv(files.get(EXPORTS[instrument].file)!);
        const values = rows.map((row) => Object.values(row).pop() ?? '');
        const flags = values.map((v) => /[,E]/.test(v));
        const { share, early } = otherShare(flags);
        expect(share, `${lab.style.id} ${instrument}`).toBeGreaterThan(0.1);
        expect(share).toBeLessThan(0.3);
        expect(early).toBe(false);
      }
    }
  });

  it('name each well and compound in compounds.csv in a way that reads back to one value', () => {
    for (const { lab, files } of labs) {
      const rows = parseCsv(files.get('compounds.csv')!);
      const wells = lab.plates.flatMap((p) => p.wells.map((w) => ({ plate: p.id, ...w })));
      expect(rows).toHaveLength(wells.length);
      const flags = rows.map((row, i) => {
        const truth = wells[i]!;
        expect(row.plate_id).toBe(truth.plate);
        expect(readers.wellOf(row.well!)).toBe(truth.well);
        expect(readers.key(row.compound_id!)).toBe(readers.key(truth.compound));
        const plainWell = writeWell(truth.well, lab.style.wellForm === 'padded');
        return row.well !== plainWell || row.compound_id !== truth.compound;
      });
      const { share, early } = otherShare(flags);
      expect(share, lab.style.id).toBeGreaterThan(0.1);
      expect(share).toBeLessThan(0.4);
      expect(early).toBe(false);
    }
  });

  it("write plates.csv dates in the lab's form and now and then another, each one day", () => {
    for (const { lab, files } of labs) {
      const rows = parseCsv(files.get('plates.csv')!);
      rows.forEach((row, i) => {
        expect(readers.dayOf(row.read_on!), row.plate_id!).toBe(lab.plates[i]!.readOn);
      });
      const odd = rows.filter(
        (row, i) => row.read_on !== writeDate(lab.plates[i]!.readOn, lab.style.dateForm),
      );
      expect(odd.length, lab.style.id).toBeGreaterThan(0);
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
    for (const { tasks, organization } of labs) {
      const params = (type: string) =>
        tasks
          .filter((t) => t.type === type)
          .map((t) => (t.expected as { params: Record<string, unknown> }).params);
      const id = organization.id;
      expect(
        params('normalize').some((p) => Object.values(p.wells as object).includes(null)),
        `${id} a well with no reading`,
      ).toBe(true);
      expect(
        params('hits').some((p) => p.qc === 'fail'),
        `${id} hits on a failed plate`,
      ).toBe(true);
      const calls = new Set(params('replicates').map((p) => p.call));
      expect(calls, `${id} replicate calls`).toEqual(new Set(['hit', 'inactive', 'inconclusive']));
      const plans = params('retest_plan') as unknown as {
        plates: { qc: string; whole: boolean; candidates: unknown[]; take: number }[];
      }[];
      const plates = plans.flatMap((p) => p.plates);
      expect(
        plates.some((p) => p.qc === 'fail' && p.whole),
        `${id} a plate to re-test whole`,
      ).toBe(true);
      expect(
        plates.some((p) => p.qc === 'fail' && !p.whole),
        `${id} a plate queued whole`,
      ).toBe(true);
      expect(
        plates.some((p) => p.candidates.length > p.take),
        `${id} more than the cap`,
      ).toBe(true);
    }
  });
});
