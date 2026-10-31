import { describe, expect, it } from 'vitest';
import { buildJobFiles } from '../src';
import { PLAIN_ROWS } from '../src/group/files';
import type { Run } from '../src/group/rules';
import { parseCsv } from '../src/lib/csv';

/**
 * Each group's exports write some values another way: a metric name with other capitals,
 * separators or spaces, a loss in scientific notation, NaN and infinity in the tracker's own
 * spellings, a learning rate as 3e-4 or 3.0e-04. Every form reads back to exactly one value.
 */

const groups = buildJobFiles().groups;

/** A metric name with its capitals, separators and spaces set aside, as the reference reads it. */
const key = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A value as the reference reads it: NaN and infinity in any spelling, else a number. */
function valueOf(text: string): number {
  const t = text.trim().toLowerCase();
  if (t === 'nan' || t === '-nan') return NaN;
  if (t === 'inf' || t === '+inf' || t === 'infinity') return Infinity;
  return Number(t);
}

const same = (a: number, b: number) => Object.is(a, b) || a === b;

describe('metrics.csv', () => {
  it('writes a fifth or so of the rows past the first five another way, and none before', () => {
    for (const { group, files } of groups) {
      const { metrics } = group.style;
      const rows = parseCsv(files.get('metrics.csv')!);
      const other = (row: (typeof rows)[number]) =>
        (row.metric !== metrics.train && row.metric !== metrics.val) ||
        /e[+-]\d\d$/.test(row.value!);
      expect(rows.slice(0, PLAIN_ROWS).some(other), group.style.id).toBe(false);
      const rest = rows.slice(PLAIN_ROWS);
      const share = rest.filter(other).length / rest.length;
      expect(share, group.style.id).toBeGreaterThan(0.15);
      expect(share, group.style.id).toBeLessThan(0.25);
      // Spread through the file, not bunched at one end.
      const quarter = Math.floor(rest.length / 4);
      for (let q = 0; q < 4; q += 1) {
        expect(rest.slice(q * quarter, (q + 1) * quarter).some(other)).toBe(true);
      }
    }
  });

  it('reads back every metric name to exactly one of the two metrics, and every loss to its value', () => {
    for (const { group, files } of groups) {
      const { metrics, axis } = group.style;
      const truth = new Map<string, number>();
      for (const run of group.sweeps.flatMap((s) => s.runs)) {
        for (const e of run.evals) {
          truth.set(`${run.run_id} ${e.at} train`, e.train);
          truth.set(`${run.run_id} ${e.at} val`, e.val);
        }
      }
      const rows = parseCsv(files.get('metrics.csv')!);
      expect(rows).toHaveLength(truth.size);
      const names = new Set<string>();
      for (const row of rows) {
        names.add(row.metric!);
        const kinds = (['train', 'val'] as const).filter(
          (k) => key(metrics[k]) === key(row.metric!),
        );
        expect(kinds, row.metric!).toHaveLength(1);
        const want = truth.get(`${row.run_id} ${row[axis]} ${kinds[0]}`);
        expect(want, `${row.run_id} ${row[axis]}`).toBeDefined();
        expect(same(valueOf(row.value!), want!), `${row.run_id} ${row[axis]} ${row.value}`).toBe(
          true,
        );
      }
      // Each group writes its names more than one way: two other forms besides the plain ones.
      expect(names.size, group.style.id).toBeGreaterThan(2);
    }
  });

  it('lists some runs newest first, and has runs that log more often than the rest', () => {
    for (const { group, files } of groups) {
      const { axis } = group.style;
      const rows = parseCsv(files.get('metrics.csv')!);
      const byRun = new Map<string, number[]>();
      for (const row of rows) {
        const list = byRun.get(row.run_id!) ?? [];
        list.push(Number(row[axis]));
        byRun.set(row.run_id!, list);
      }
      const reversed = [...byRun.values()].filter((at) => at[0]! > at.at(-1)!);
      expect(reversed.length, group.style.id).toBeGreaterThan(3);
      if (group.style.fineInterval !== null) {
        const often = (run: Run) => run.evals[0]!.at === group.style.fineInterval;
        expect(
          group.sweeps.some((s) => s.runs.some(often)),
          group.style.id,
        ).toBe(true);
      }
    }
  });
});

describe('configs', () => {
  it('read back every learning rate, however written, to the one on the grid', () => {
    for (const { group, files } of groups) {
      const { fields, configs } = group.style;
      const runs = group.sweeps.flatMap((s) => s.runs);
      const written: Record<string, string>[] =
        configs === 'columns'
          ? parseCsv(files.get('runs.csv')!).map((row) => ({
              run_id: row.run_id!,
              lr: row[fields.lr]!,
              warmup: row[fields.warmup]!,
            }))
          : files
              .get('configs.json')!
              .split('\n')
              .filter((line) => line.startsWith('  "'))
              .map((line) => {
                const [, id, lr, warmup] =
                  /^ {2}"([^"]+)": \{"[^"]+": ([^,]+), "[^"]+": (\d+)/.exec(line)!;
                return { run_id: id!, lr: lr!, warmup: warmup! };
              });
      expect(written).toHaveLength(runs.length);
      expect(new Set(written.map((w) => w.lr)).size).toBeGreaterThan(
        new Set(runs.map((r) => r.knobs.lr)).size,
      );
      for (const [i, run] of runs.entries()) {
        const w = written[i]!;
        expect(w.run_id).toBe(run.run_id);
        expect(Number(w.lr), w.lr).toBe(run.knobs.lr);
        expect(Number(w.warmup)).toBe(run.knobs.warmup);
        const sweep = group.sweeps.find((s) => s.sweep_id === run.sweep_id)!;
        expect(sweep.grid.lr).toContain(Number(w.lr));
      }
      if (configs === 'json') expect(() => JSON.parse(files.get('configs.json')!)).not.toThrow();
    }
  });

  it("write each sweep's grid and baseline so they read back to its values", () => {
    for (const { group, files } of groups) {
      const rows = parseCsv(files.get('sweeps.csv')!);
      for (const [i, sweep] of group.sweeps.entries()) {
        const parts = (text: string) =>
          Object.fromEntries(
            text.split(';').map((part) => {
              const [name, values] = part.split('=') as [string, string];
              return [name.trim(), values.split('/').map(Number)];
            }),
          );
        const grid = parts(rows[i]!.grid!);
        expect(grid[group.style.fields.lr]).toEqual(sweep.grid.lr);
        expect(grid[group.style.fields.warmup]).toEqual(sweep.grid.warmup);
        const baseline = parts(rows[i]!.baseline!);
        expect(baseline[group.style.fields.lr]).toEqual([sweep.baseline.lr]);
        expect(baseline[group.style.fields.warmup]).toEqual([sweep.baseline.warmup]);
      }
    }
  });
});
