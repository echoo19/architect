import vm from 'node:vm';
import type { CheckResult, JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { job, orgOf, paramsOf } from './helpers';

/**
 * The checker passes the ground truth and any other plan the policy allows, and fails the
 * common mistakes with a reason that starts with what is wrong.
 */

interface PlatePlan {
  plate: string;
  qc: 'pass' | 'fail';
  whole: boolean;
  candidates: { compound: string; reason: string }[];
  take: number;
}
interface Plan {
  requested_on: string;
  qc_reason: string;
  plates: PlatePlan[];
  ids: string[];
}

const ofType = (type: string) => job.tasksOfType(type);
const params = <T>(task: Task) => paramsOf(task) as unknown as T;

function failsWith(result: CheckResult, start: string) {
  expect(result.pass, result.reason).toBe(false);
  expect(result.reason.startsWith(start), result.reason).toBe(true);
}

const asked = (task: Task, answer: JsonValue, added: CsvRow[] = []) =>
  job.check(task, job.context(task, answer, added));

/** Rows that carry out a plan: each plate whole, or the candidates `pick` chooses. */
function planRows(
  plan: Plan,
  pick: (p: PlatePlan) => PlatePlan['candidates'] = (p) => p.candidates.slice(0, p.take),
): CsvRow[] {
  const rows = plan.plates.flatMap((p) =>
    p.whole
      ? [{ plate: p.plate, compound: null as string | null, reason: plan.qc_reason }]
      : p.qc === 'pass'
        ? pick(p).map((c) => ({
            plate: p.plate,
            compound: c.compound as string | null,
            reason: c.reason,
          }))
        : [],
  );
  return rows.map((row, i) => ({
    retest_id: plan.ids[i] ?? `X-${i}`,
    plate_id: row.plate,
    compound_id: row.compound,
    reason: row.reason,
    requested_on: plan.requested_on,
  }));
}

describe('the checker sandbox', () => {
  it('has no clock and no randomness, and defines the six validators', () => {
    const sandbox = job.checkerSandbox();
    expect(vm.runInContext('typeof Date', sandbox)).toBe('undefined');
    expect(vm.runInContext('typeof Math.random', sandbox)).toBe('undefined');
    expect(vm.runInContext('Object.keys(validators).sort().join()', sandbox)).toBe(
      'hit_set,inhibition,plate_qc,plate_report,replicate_call,retest_plan',
    );
  });
});

describe('inhibition', () => {
  type P = { wells: Record<string, number | null> };
  it('passes the truth, rounded, with wells named any way', () => {
    for (const task of ofType('normalize')) {
      const wells = params<P>(task).wells;
      const rounded = Object.fromEntries(
        Object.entries(wells).map(([w, v]) => [
          w.toLowerCase().replace(/^([a-p])0?/, '$1 0'),
          v === null ? null : Math.round(v * 10) / 10,
        ]),
      );
      expect(asked(task, { inhibition: rounded }), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails a value off by more than the tolerance, a missing well, and a number for no reading', () => {
    for (const task of ofType('normalize')) {
      const wells = params<P>(task).wells;
      const [name, value] = Object.entries(wells).find(([, v]) => v !== null)!;
      failsWith(
        asked(task, { inhibition: { ...wells, [name]: value! + 1 } }),
        `inhibition for ${name}`,
      );
      const { [name]: _, ...fewer } = wells;
      failsWith(asked(task, { inhibition: fewer }), 'inhibition has no value');
      const blank = Object.entries(wells).find(([, v]) => v === null);
      if (blank) {
        failsWith(
          asked(task, { inhibition: { ...wells, [blank[0]]: 0 } }),
          `inhibition for ${blank[0]}`,
        );
      }
    }
  });

  it('fails an answer that wrote to the queue', () => {
    const task = ofType('normalize')[0]!;
    const plate = paramsOf(task).plate as string;
    const added = [
      { retest_id: 'Z-1', plate_id: plate, compound_id: null, reason: 'x', requested_on: 'x' },
    ];
    failsWith(asked(task, { inhibition: params<P>(task).wells }, added), 'retests.csv changed');
  });
});

describe('hit_set', () => {
  type P = { hits: string[]; qc: string };
  it('passes the truth in any order and case', () => {
    for (const task of ofType('hits')) {
      const hits = [...params<P>(task).hits].reverse().map((h) => h.toLowerCase());
      expect(asked(task, { hits }), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails a missing hit, an extra one, a repeat, and hits on a failed plate', () => {
    const passing = ofType('hits').filter(
      (t) => params<P>(t).qc === 'pass' && params<P>(t).hits.length > 1,
    );
    for (const task of passing) {
      const hits = params<P>(task).hits;
      failsWith(asked(task, { hits: hits.slice(1) }), 'hits is missing');
      failsWith(asked(task, { hits: [...hits, 'NOT-A-HIT'] }), 'hits includes');
      failsWith(asked(task, { hits: [...hits, hits[0]!] }), 'hits lists');
    }
    const failed = ofType('hits').filter((t) => params<P>(t).qc === 'fail');
    expect(failed.length).toBeGreaterThan(0);
    for (const task of failed) {
      expect(asked(task, { hits: [] }), task.id).toMatchObject({ pass: true });
      failsWith(asked(task, { hits: ['ANY-1'] }), 'hits should be empty');
    }
  });
});

describe('plate_qc', () => {
  type P = { plate: string; z_prime: number; qc: string };
  it('passes the truth to three places, and fails a Z′ off or the wrong verdict', () => {
    for (const task of ofType('qc')) {
      const p = params<P>(task);
      const truth = {
        plate: p.plate,
        z_prime: Number(p.z_prime.toFixed(3)),
        qc: p.qc.toUpperCase(),
      };
      expect(asked(task, truth), task.id).toMatchObject({ pass: true });
      failsWith(asked(task, { ...truth, z_prime: p.z_prime + 0.05 }), 'z_prime is');
      failsWith(asked(task, { ...truth, qc: p.qc === 'pass' ? 'fail' : 'pass' }), 'qc is');
    }
  });
});

describe('replicate_call', () => {
  type P = {
    compound: string;
    inhibition: number[];
    mean: number | null;
    agree: boolean;
    call: string;
  };
  const truth = (p: P) => ({
    compound: p.compound,
    inhibition: [...p.inhibition].reverse(),
    mean: p.mean,
    agree: p.agree,
    call: p.call,
  });

  it('passes the truth with the wells in any order', () => {
    for (const task of ofType('replicates')) {
      expect(asked(task, truth(params<P>(task))), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails a wrong mean, a wrong agreement, and a wrong call', () => {
    for (const task of ofType('replicates')) {
      const p = params<P>(task);
      failsWith(asked(task, { ...truth(p), mean: (p.mean ?? 0) + 2 }), 'mean is');
      failsWith(asked(task, { ...truth(p), agree: !p.agree }), 'agree is');
      failsWith(
        asked(task, { ...truth(p), call: p.call === 'hit' ? 'inactive' : 'hit' }),
        'call is',
      );
      if (p.call === 'inconclusive' && p.inhibition.length === 1) {
        failsWith(
          asked(task, { ...truth(p), inhibition: [...p.inhibition, 0] }),
          'inhibition lists',
        );
      }
    }
  });
});

describe('retest_plan', () => {
  const tasks = ofType('retest_plan');
  const answer = (rows: CsvRow[]) => ({ retests: rows.length });

  it('passes the truth, and any other plan the policy allows, its rows in any order', () => {
    let choices = 0;
    for (const task of tasks) {
      const plan = params<Plan>(task);
      const rows = planRows(plan);
      expect(asked(task, answer(rows), rows), task.id).toMatchObject({ pass: true });
      const other = planRows(plan, (p) => p.candidates.slice(-p.take)).reverse();
      const ids = [...plan.ids].reverse();
      const shuffled = other.map((row, i) => ({ ...row, retest_id: ids[i]! }));
      expect(asked(task, answer(shuffled), shuffled), task.id).toMatchObject({ pass: true });
      if (plan.plates.some((p) => p.candidates.length > p.take)) choices += 1;
    }
    expect(choices).toBeGreaterThan(3);
  });

  it('fails a plan over the cap, a compound already queued, and compounds of a failed plate', () => {
    for (const task of tasks) {
      const plan = params<Plan>(task);
      const over = plan.plates.find((p) => p.candidates.length > p.take);
      if (over) {
        const rows = planRows(plan, (p) =>
          p === over ? p.candidates : p.candidates.slice(0, p.take),
        );
        failsWith(
          asked(task, answer(rows), rows),
          `retests.csv gained ${over.candidates.length} rows for ${over.plate}`,
        );
      }
      const failed = plan.plates.find((p) => p.qc === 'fail' && p.whole);
      if (failed) {
        const rows = planRows(plan).map((row) =>
          row.plate_id === failed.plate ? { ...row, compound_id: 'SOME-1' } : row,
        );
        failsWith(asked(task, answer(rows), rows), `retests.csv: ${failed.plate} fails QC`);
      }
      const queued = plan.plates.find((p) => p.qc === 'fail' && !p.whole);
      if (queued) {
        const rows = [
          ...planRows(plan),
          {
            retest_id: 'X',
            plate_id: queued.plate,
            compound_id: null,
            reason: plan.qc_reason,
            requested_on: plan.requested_on,
          },
        ];
        failsWith(
          asked(task, answer(rows), rows),
          `retests.csv: ${queued.plate} is already queued whole`,
        );
      }
    }
  });

  it('fails a compound the queue already holds', () => {
    let checked = 0;
    for (const task of tasks) {
      const plan = params<Plan>(task);
      const held = job
        .table(orgOf(task), 'retests.csv')
        .find(
          (r) =>
            r.compound_id !== null &&
            plan.plates.some((p) => p.plate === r.plate_id && p.qc === 'pass' && p.take > 0),
        );
      if (!held) continue;
      const rows = planRows(plan).map((row) =>
        row.plate_id === held.plate_id && row.compound_id !== null
          ? { ...row, compound_id: held.compound_id ?? null }
          : row,
      );
      failsWith(asked(task, answer(rows), rows), `compound_id "${held.compound_id}"`);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('fails a wrong reason, a wrong date, wrong ids, a changed old row, and a wrong count', () => {
    for (const task of tasks) {
      const plan = params<Plan>(task);
      const rows = planRows(plan);
      if (rows.length === 0) continue;
      failsWith(
        asked(task, answer(rows), [{ ...rows[0]!, reason: 'OTHER' }, ...rows.slice(1)]),
        'reason is',
      );
      failsWith(
        asked(task, answer(rows), [{ ...rows[0]!, requested_on: '2026-01-01' }, ...rows.slice(1)]),
        'requested_on is',
      );
      failsWith(
        asked(task, answer(rows), [{ ...rows[0]!, retest_id: 'NEW-1' }, ...rows.slice(1)]),
        'retest_id:',
      );
      failsWith(asked(task, { retests: rows.length + 1 }, rows), 'retests in the ANSWER');
      const original = job.table(orgOf(task), 'retests.csv');
      const edited = [{ ...original[0]!, reason: 'CHANGED' }, ...original.slice(1), ...rows];
      failsWith(
        job.check(task, job.contextWithQueue(task, answer(rows), edited)),
        'retests.csv: an existing row',
      );
    }
  });
});

describe('plate_report', () => {
  type P = { plate: string; z_prime: number; qc: string; hits: string[]; retests: Plan };
  const truth = (p: P) => ({
    plate: p.plate,
    z_prime: p.z_prime,
    qc: p.qc,
    hits: p.hits,
    retests: planRows(p.retests).length,
  });

  it('passes the truth', () => {
    for (const task of ofType('plate_report')) {
      const p = params<P>(task);
      expect(asked(task, truth(p), planRows(p.retests)), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails hits on a failed plate, a missing hit, a wrong Z′, and missing re-tests', () => {
    for (const task of ofType('plate_report')) {
      const p = params<P>(task);
      const rows = planRows(p.retests);
      if (p.qc === 'fail')
        failsWith(asked(task, { ...truth(p), hits: ['ANY-1'] }, rows), 'hits should be empty');
      if (p.hits.length > 0)
        failsWith(asked(task, { ...truth(p), hits: p.hits.slice(1) }, rows), 'hits is missing');
      failsWith(asked(task, { ...truth(p), z_prime: p.z_prime - 0.1 }, rows), 'z_prime is');
      if (rows.length > 0) failsWith(asked(task, truth(p), rows.slice(1)), 'retests.csv');
    }
  });
});
