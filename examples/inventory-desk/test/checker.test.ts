import vm from 'node:vm';
import { writeDate } from '@architect/example-assay-desk';
import type { CsvRow, DateForm } from '@architect/example-assay-desk';
import type { CheckResult, JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { DESK_STYLES } from '../src/lab/style';
import { writeVolume } from '../src/lab/volume';
import type { Unit } from '../src/lab/volume';
import { job, orgOf, paramsOf } from './helpers';

/**
 * The checker passes the ground truth however its ids, volumes and dates are written, and fails
 * the common mistakes with a reason that starts with what is wrong.
 */

type Draw = { lot: string; location: string; amount_ul: number };
type Allocation = { compound: string; draws: Draw[]; reason: string | null };
type Reservation = {
  allocations: Allocation[];
  reserved_on: string;
  unit: Unit;
  date_form: DateForm;
  ids: string[];
};

const ofType = (type: string) => job.tasksOfType(type);
const params = <T>(task: Task) => paramsOf(task) as unknown as T;

function failsWith(result: CheckResult, start: string) {
  expect(result.pass, result.reason).toBe(false);
  expect(result.reason.startsWith(start), result.reason).toBe(true);
}

const asked = (task: Task, answer: JsonValue, added: CsvRow[] = []) =>
  job.check(task, job.context(task, answer, added));

const asJson = (value: unknown) => value as JsonValue;

/** The rows a reservation task's plan adds, written the lab's way unless `amount` says otherwise. */
function planRows(
  plan: Reservation,
  amount = (ul: number) => writeVolume(Math.round(ul * 1000), plan.unit),
): CsvRow[] {
  const draws = plan.allocations.flatMap((a) =>
    a.draws.map((d) => ({ compound: a.compound, ...d })),
  );
  return draws.map((d, i) => ({
    reservation_id: plan.ids[i]!,
    compound_id: d.compound,
    lot: d.lot,
    amount: amount(d.amount_ul),
    reserved_on: writeDate(plan.reserved_on, plan.date_form),
  }));
}

function answerOf(plan: Reservation): JsonValue {
  return {
    reserved: plan.allocations.filter((a) => a.reason === null).map((a) => a.compound),
    unavailable: plan.allocations
      .filter((a) => a.reason !== null)
      .map((a) => ({ compound: a.compound, reason: a.reason })),
  };
}

const firstDrawn = (allocations: Allocation[]) => allocations.find((a) => a.reason === null);
const firstShort = (allocations: Allocation[]) => allocations.find((a) => a.reason !== null);

describe('the checker sandbox', () => {
  it('has no clock and no randomness, and defines the four validators', () => {
    const sandbox = job.checkerSandbox();
    expect(vm.runInContext('typeof Date', sandbox)).toBe('undefined');
    expect(vm.runInContext('typeof Math.random', sandbox)).toBe('undefined');
    expect(vm.runInContext('Object.keys(validators).sort().join()', sandbox)).toBe(
      'allocation,lot_pick,reservation,usable_volume',
    );
  });
});

describe('usable_volume', () => {
  type P = { compound: string; usable_ul: number; lots: string[] };
  const truth = (p: P) => ({ compound: p.compound, usable_ul: p.usable_ul, lots: p.lots });

  it('passes the truth, rounded, with ids written any way', () => {
    for (const task of ofType('usable')) {
      const p = params<P>(task);
      const answer = {
        compound: p.compound.toLowerCase(),
        usable_ul: String(Math.round(p.usable_ul * 100) / 100),
        lots: [...p.lots].reverse().map((l) => ` ${l.toLowerCase()}`),
      };
      expect(asked(task, answer), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails a wrong volume, a missing or extra lot, and a write', () => {
    for (const task of ofType('usable')) {
      const p = params<P>(task);
      failsWith(asked(task, { ...truth(p), usable_ul: p.usable_ul + 1 }), 'usable_ul is');
      failsWith(asked(task, { ...truth(p), lots: [...p.lots, 'NOT-A-LOT'] }), 'lots includes');
      if (p.lots.length > 0) {
        failsWith(asked(task, { ...truth(p), lots: p.lots.slice(1) }), 'lots is missing');
      }
    }
    const task = ofType('usable')[0]!;
    const added = [
      { reservation_id: 'X', compound_id: 'X', lot: 'X', amount: '1 µL', reserved_on: 'x' },
    ];
    failsWith(asked(task, truth(params<P>(task)), added), 'reservations.csv changed');
  });
});

describe('lot_pick', () => {
  type P = Allocation;
  const truth = (p: P) => ({ compound: p.compound, draws: p.draws, reason: p.reason });

  it('passes the truth, with the draws in any order and ids written any way', () => {
    for (const task of ofType('pick_lot')) {
      const p = params<P>(task);
      const draws = [...p.draws]
        .reverse()
        .map((d) => ({ ...d, lot: d.lot.toLowerCase(), location: d.location.toLowerCase() }));
      expect(asked(task, { ...truth(p), draws }), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails a wrong lot, amount or location, a missing reason, and a draw with nothing to draw', () => {
    for (const task of ofType('pick_lot')) {
      const p = params<P>(task);
      if (p.reason === null) {
        const [first, ...rest] = p.draws;
        const draw = first!;
        failsWith(
          asked(task, { ...truth(p), draws: [{ ...draw, lot: 'NOT-A-LOT' }, ...rest] }),
          `draws for ${p.compound} has no draw from lot ${draw.lot}`,
        );
        failsWith(
          asked(task, {
            ...truth(p),
            draws: [{ ...draw, amount_ul: draw.amount_ul + 1 }, ...rest],
          }),
          `amount_ul from lot ${draw.lot}`,
        );
        failsWith(
          asked(task, { ...truth(p), draws: [{ ...draw, location: 'NOWHERE' }, ...rest] }),
          `location of lot ${draw.lot}`,
        );
        failsWith(asked(task, { ...truth(p), reason: 'LOW' }), `reason for ${p.compound}`);
      } else {
        failsWith(asked(task, { ...truth(p), reason: null }), `reason for ${p.compound}`);
        failsWith(asked(task, { ...truth(p), reason: 'OTHER' }), `reason for ${p.compound}`);
        failsWith(
          asked(task, {
            ...truth(p),
            draws: [{ lot: 'ANY', location: 'ANY', amount_ul: 1 }],
          }),
          `draws for ${p.compound} should be an empty list`,
        );
        const { draws: _, ...missing } = truth(p);
        failsWith(asked(task, missing), `draws for ${p.compound} should be an empty list`);
      }
    }
  });

  it('meets every reason, and a re-test drawn from two lots where lots are combined', () => {
    for (const { id, policy } of DESK_STYLES) {
      const tasks = ofType('pick_lot').filter((t) => t.org === id);
      const reasons = new Set(tasks.map((t) => params<P>(t).reason));
      expect(reasons, id).toEqual(new Set([null, ...Object.values(policy.codes)]));
      if (policy.combine)
        expect(
          tasks.some((t) => params<P>(t).draws.length > 1),
          id,
        ).toBe(true);
    }
  });
});

describe('allocation', () => {
  type P = { allocations: Allocation[] };

  it('passes the truth, the compounds in any order', () => {
    for (const task of ofType('allocate')) {
      const allocations = [...params<P>(task).allocations].reverse();
      expect(asked(task, asJson({ allocations })), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails a missing compound, an extra one, a repeat, and a compound with nothing reported as drawn', () => {
    for (const task of ofType('allocate')) {
      const { allocations } = params<P>(task);
      failsWith(
        asked(task, asJson({ allocations: allocations.slice(1) })),
        `allocations has no entry for ${allocations[0]!.compound}`,
      );
      const extra = { compound: 'NOT-ON-LIST', draws: [], reason: null };
      failsWith(
        asked(task, asJson({ allocations: [...allocations, extra] })),
        'allocations includes',
      );
      failsWith(
        asked(task, asJson({ allocations: [...allocations, allocations[0]] })),
        `allocations lists ${allocations[0]!.compound} twice`,
      );
      const short = firstShort(allocations);
      if (short) {
        const drawn = allocations.map((a) => (a === short ? { ...a, reason: null } : a));
        failsWith(asked(task, asJson({ allocations: drawn })), `reason for ${short.compound}`);
      }
    }
  });
});

describe('reservation', () => {
  const tasks = ofType('reserve');

  it("passes the truth written the lab's way, its rows in any order, µL typed uL", () => {
    for (const task of tasks) {
      const plan = params<Reservation>(task);
      const rows = planRows(plan);
      expect(asked(task, answerOf(plan), rows), task.id).toMatchObject({ pass: true });
      const typed = rows
        .reverse()
        .map((row) => ({ ...row, amount: row.amount!.replace('µL', 'uL') }));
      expect(asked(task, answerOf(plan), typed), task.id).toMatchObject({ pass: true });
    }
  });

  it("fails an amount or a date not written the lab's way, even when its value is right", () => {
    let checked = 0;
    for (const task of tasks) {
      const plan = params<Reservation>(task);
      const rows = planRows(plan);
      if (rows.length === 0) continue;
      const other = (['uL', 'mL', 'nL'] as const).find((u) => u !== plan.unit)!;
      const otherForm = (['iso', 'us', 'dmy'] as const).find((f) => f !== plan.date_form)!;
      const [first, ...rest] = rows;
      const ul = plan.allocations.flatMap((a) => a.draws)[0]!.amount_ul;
      const written = (row: CsvRow): CsvRow[] => [{ ...first!, ...row }, ...rest];
      const unitless = writeVolume(Math.round(ul * 1000), plan.unit).split(' ')[0]!;
      for (const amount of [writeVolume(Math.round(ul * 1000), other), unitless]) {
        failsWith(asked(task, answerOf(plan), written({ amount })), 'amount is');
      }
      const date = writeDate(plan.reserved_on, otherForm);
      failsWith(asked(task, answerOf(plan), written({ reserved_on: date })), 'reserved_on is');
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("fails Fenwick's demo reservation in mL, as a bare number, or with a US date", () => {
    const task = tasks.find((t) => t.org === 'fenwick')!;
    const plan = params<Reservation>(task);
    const [row] = planRows(plan);
    expect(row).toMatchObject({ amount: '20 µL', reserved_on: '2026-10-14' });
    expect(asked(task, answerOf(plan), [row!])).toMatchObject({ pass: true });
    for (const amount of ['0.02 mL', '20', '20000 nL']) {
      failsWith(asked(task, answerOf(plan), [{ ...row!, amount }]), 'amount is');
    }
    failsWith(
      asked(task, answerOf(plan), [{ ...row!, reserved_on: '10/14/2026' }]),
      'reserved_on is',
    );
  });

  it('fails a row for a compound with nothing to draw, a wrong lot, amount, date or id, and a missing row', () => {
    for (const task of tasks) {
      const plan = params<Reservation>(task);
      const rows = planRows(plan);
      const short = firstShort(plan.allocations);
      if (short) {
        const extra = { ...rows[0]!, compound_id: short.compound, reservation_id: 'X-1' };
        failsWith(
          asked(task, answerOf(plan), [...rows, extra]),
          `reservations.csv: ${short.compound} has nothing to draw`,
        );
      }
      if (rows.length === 0) continue;
      const [first, ...rest] = rows;
      failsWith(asked(task, answerOf(plan), [{ ...first!, lot: 'NOT-A-LOT' }, ...rest]), 'lot ');
      failsWith(asked(task, answerOf(plan), [{ ...first!, amount: '1 µL' }, ...rest]), 'amount is');
      failsWith(
        asked(task, answerOf(plan), [{ ...first!, reserved_on: '2026-01-01' }, ...rest]),
        'reserved_on is',
      );
      failsWith(
        asked(task, answerOf(plan), [{ ...first!, reservation_id: 'NEW-1' }, ...rest]),
        'reservation_id:',
      );
      failsWith(asked(task, answerOf(plan), rest), 'reservations.csv has no row');
      failsWith(asked(task, answerOf(plan), [...rows, first!]), 'reservations.csv holds lot');
      const original = job.table(orgOf(task), 'reservations.csv');
      const edited = [{ ...original[0]!, amount: '999 µL' }, ...original.slice(1), ...rows];
      failsWith(
        job.check(task, job.contextWithHolds(task, answerOf(plan), edited)),
        'reservations.csv: an existing row',
      );
    }
  });

  it('fails an answer that names the wrong compounds or reasons', () => {
    for (const task of tasks) {
      const plan = params<Reservation>(task);
      const rows = planRows(plan);
      const drawn = firstDrawn(plan.allocations);
      const short = firstShort(plan.allocations);
      const answer = answerOf(plan) as { reserved: string[]; unavailable: { reason: string }[] };
      if (drawn) {
        failsWith(asked(task, { ...answer, reserved: [] }, rows), 'reserved is missing');
      }
      if (short) {
        failsWith(asked(task, { ...answer, unavailable: [] }, rows), 'unavailable has no entry');
        const wrong = answer.unavailable.map((u) => ({ ...u, reason: 'OTHER' }));
        failsWith(asked(task, { ...answer, unavailable: wrong }, rows), 'reason for');
      }
    }
  });

  it("includes the demo's list at every lab, with a compound that has nothing to draw", () => {
    for (const org of ['fenwick', 'alder-row', 'saltmarsh', 'corvid-hill']) {
      const first = tasks.find((t) => t.org === org)!;
      expect(firstShort(params<Reservation>(first).allocations), org).toBeDefined();
    }
  });
});
