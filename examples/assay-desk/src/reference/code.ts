import type { Policy } from '../lab/policy';

/**
 * The code the reference sends to `run`, the way a careful agent would write it after reading
 * policy.md: the lab's numbers go in as `P`, and the code reads the plate's own files. It knows
 * nothing about one lab or one instrument. It finds a plate's export from plates.csv, finds the
 * plate, well and reading columns of that export by their names (a well named in one column, as
 * `A01` or `A1`, or as a row and a column), and reads a value as a number only when it is one,
 * with any thousands separators or scientific notation; anything else (blank, a dash, NaN, an
 * overflow mark) has no reading. Ids are matched with case, spaces and punctuation set aside.
 */
export function helpers(policy: Policy): string {
  return `const P = ${JSON.stringify(policy)};
const key = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const wellOf = (s) => {
  const m = /^\\s*([A-Pa-p])\\s*0*(\\d+)\\s*$/.exec(String(s));
  return m ? m[1].toUpperCase() + Number(m[2]) : null;
};
const reading = (s) => {
  const t = String(s).trim().replace(/,/g, '');
  return /^[-+]?(\\d+\\.?\\d*|\\.\\d+)(e[-+]?\\d+)?$/i.test(t) ? Number(t) : null;
};
const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';
const two = (n) => String(n).padStart(2, '0');
const dayOf = (s) => {
  const t = String(s).trim();
  let m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/.exec(t);
  if (m) return m[3] + '-' + two(m[1]) + '-' + two(m[2]);
  m = /^(\\d{1,2})-([A-Za-z]{3})-(\\d{4})$/.exec(t);
  if (m) return m[3] + '-' + two(MONTHS.indexOf(m[2]) / 3 + 1) + '-' + two(m[1]);
  return null;
};
const cache = {};
const read = (name) => (cache[name] = cache[name] || csv.parse(files.read('data/' + name)));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const round = (x, d) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
function plateWells(plate) {
  const rows = read(plate.export_file);
  const cols = Object.keys(rows[0]);
  const col = (re) => cols.find((c) => re.test(c));
  const pc = col(/plate|barcode/i);
  const wc = col(/well/i);
  const rc = col(/^row$/i);
  const cc = col(/^col/i);
  const vc = cols.find((c) => ![pc, wc, rc, cc].includes(c));
  const signal = {};
  for (const r of rows) {
    if (key(r[pc]) !== key(plate.plate_id)) continue;
    signal[wc ? wellOf(r[wc]) : wellOf(r[rc] + r[cc])] = reading(r[vc]);
  }
  return read('compounds.csv')
    .filter((r) => key(r.plate_id) === key(plate.plate_id))
    .map((r) => ({ well: wellOf(r.well), compound: r.compound_id.trim(), signal: signal[wellOf(r.well)] ?? null }));
}
function analyse(id) {
  const plate = read('plates.csv').find((p) => key(p.plate_id) === key(id));
  const wells = plateWells(plate);
  const isNeg = (w) => key(w.compound) === key(P.neg);
  const isPos = (w) => key(w.compound) === key(P.pos);
  const neg = wells.filter((w) => isNeg(w) && w.signal !== null).map((w) => w.signal);
  const pos = wells.filter((w) => isPos(w) && w.signal !== null).map((w) => w.signal);
  const mn = mean(neg);
  const mp = mean(pos);
  const pi = (x) => (x === null ? null : (100 * (mn - x)) / (mn - mp));
  const z = 1 - (3 * (sd(pos) + sd(neg))) / Math.abs(mp - mn);
  const t = P.hit.kind === 'percent' ? P.hit.value : P.hit.value * sd(neg.map(pi));
  const groups = new Map();
  for (const w of wells) {
    if (isNeg(w) || isPos(w)) continue;
    if (!groups.has(key(w.compound))) groups.set(key(w.compound), { compound: w.compound, wells: [] });
    groups.get(key(w.compound)).wells.push(w);
  }
  const compounds = [...groups.values()].map((g) => {
    const values = g.wells.filter((w) => w.signal !== null).map((w) => pi(w.signal));
    const m = values.length > 0 ? mean(values) : null;
    const agree = values.length === g.wells.length && Math.max(...values) - Math.min(...values) <= P.agree;
    const reaches = P.rule === 'mean' ? m !== null && m >= t : values.every((v) => v >= t);
    const call = !agree ? 'inconclusive' : reaches ? 'hit' : 'inactive';
    const borderline = call !== 'inconclusive' && m !== null && Math.abs(m - t) < P.band;
    return { compound: g.compound, values, mean: m, agree, call, borderline };
  });
  const pass = z >= P.zMin;
  const hits = pass ? compounds.filter((c) => c.call === 'hit').map((c) => c.compound) : [];
  return { plate: plate.plate_id, wells, pi, z, pass, compounds, hits };
}
function needs(a) {
  const held = read('retests.csv').filter((r) => key(r.plate_id) === key(a.plate));
  if (!a.pass) {
    return held.some((r) => r.compound_id.trim() === '') ? [] : [{ plate_id: a.plate, compound_id: '', reason: P.codes.qc }];
  }
  return a.compounds
    .filter((c) => c.call === 'inconclusive' || c.borderline)
    .filter((c) => !held.some((r) => key(r.compound_id) === key(c.compound)))
    .slice(0, P.cap)
    .map((c) => ({
      plate_id: a.plate,
      compound_id: c.compound,
      reason: c.call === 'inconclusive' ? P.codes.inconclusive : P.codes.borderline,
    }));
}
function numbered(rows, day) {
  const ids = read('retests.csv').map((r) => r.retest_id);
  const last = /^(.*?)(\\d+)$/.exec(ids[ids.length - 1]);
  const top = Math.max(...ids.map((id) => Number(/(\\d+)$/.exec(id)[1])));
  return rows.map((r, i) => ({
    retest_id: last[1] + String(top + i + 1).padStart(last[2].length, '0'),
    ...r,
    requested_on: day,
  }));
}`;
}

const text = (value: unknown) => JSON.stringify(value);

/** Percent inhibition of the wells named, keyed as the request names them. */
export function normalizeCode(policy: Policy, plate: string, wells: readonly string[]): string {
  return `${helpers(policy)}
const a = analyse(${text(plate)});
const at = (name) => a.wells.find((w) => w.well === wellOf(name));
({ inhibition: Object.fromEntries(${text(wells)}.map((name) => [name, round(a.pi(at(name).signal), 2)])) })`;
}

export function hitsCode(policy: Policy, plate: string): string {
  return `${helpers(policy)}
const a = analyse(${text(plate)});
({ hits: a.hits })`;
}

export function qcCode(policy: Policy, plate: string): string {
  return `${helpers(policy)}
const a = analyse(${text(plate)});
({ plate: a.plate, z_prime: round(a.z, 3), qc: a.pass ? 'pass' : 'fail' })`;
}

export function replicatesCode(policy: Policy, plate: string, compound: string): string {
  return `${helpers(policy)}
const a = analyse(${text(plate)});
const c = a.compounds.find((x) => key(x.compound) === key(${text(compound)}));
({ compound: c.compound, inhibition: c.values.map((v) => round(v, 2)), mean: round(c.mean, 2), agree: c.agree, call: c.call })`;
}

/** The plates a request names, or every plate read on the day it names. */
export type PlatePick = { plates: string[] } | { readOn: string };

export function retestCode(policy: Policy, pick: PlatePick, day: string): string {
  const ids =
    'plates' in pick
      ? text(pick.plates)
      : `read('plates.csv').filter((p) => dayOf(p.read_on) === ${text(pick.readOn)}).map((p) => p.plate_id)`;
  return `${helpers(policy)}
const ids = ${ids};
({ plates: ids, rows: numbered(ids.flatMap((id) => needs(analyse(id))), ${text(day)}) })`;
}

export function reportCode(policy: Policy, plate: string, day: string): string {
  return `${helpers(policy)}
const a = analyse(${text(plate)});
({ plate: a.plate, z_prime: round(a.z, 3), qc: a.pass ? 'pass' : 'fail', hits: a.hits, rows: numbered(needs(a), ${text(day)}) })`;
}
