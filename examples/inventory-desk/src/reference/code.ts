import type { Policy } from '../lab/policy';

/**
 * The code the reference sends to `run`, the way a careful agent would write it after reading
 * policy.md: the lab's numbers go in as `P` and the day of the request as `D`, and the code reads
 * the lab's own files. It knows nothing about one lab. It reads a volume with whatever unit it is
 * written in and a date in any of the three forms, works out each lot's free volume from the
 * reservations, and draws by the policy. Ids are matched with case, spaces and punctuation set
 * aside.
 */
export function helpers(policy: Policy, day: string): string {
  return `const P = ${JSON.stringify(policy)};
const D = ${JSON.stringify(day)};
const key = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const PER = { ul: 1000, ml: 1000000, nl: 1 };
const nl = (s) => {
  const m = /^\\s*(\\d+(?:\\.\\d+)?)\\s*([µμu]l|ml|nl)\\s*$/i.exec(String(s));
  return Math.round(Number(m[1]) * PER[m[2].toLowerCase().replace(/^[µμ]/, 'u')]);
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
  return m[3] + '-' + two(MONTHS.indexOf(m[2]) / 3 + 1) + '-' + two(m[1]);
};
const days = (from, to) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
const cache = {};
const read = (name) => (cache[name] = cache[name] || csv.parse(files.read('data/' + name)));
const holds = () => read('reservations.csv');
function lotsOf(id) {
  return read('inventory.csv')
    .filter((r) => key(r.compound_id) === key(id))
    .map((r) => ({
      lot: r.lot,
      location: r.location,
      expires: dayOf(r.expires),
      free: holds().filter((h) => key(h.lot) === key(r.lot)).reduce((s, h) => s - nl(h.amount), nl(r.quantity)),
    }));
}
const inDate = (l) => days(D, l.expires) >= P.cutoff;
function usable(id) {
  const least = P.combine ? 1 : P.minimum;
  return lotsOf(id)
    .filter((l) => inDate(l) && l.free >= least)
    .sort((a, b) => (P.choose === 'expiry' ? days(b.expires, a.expires) : b.free - a.free));
}
function allocate(id) {
  const none = (reason) => ({ compound: id, draws: [], reason });
  if (holds().filter((h) => key(h.compound_id) === key(id)).length >= P.maxHolds) return none(P.codes.limit);
  if (!lotsOf(id).some(inDate)) return none(P.codes.expired);
  const draws = [];
  let needed = P.minimum;
  for (const l of usable(id)) {
    if (needed === 0) break;
    const amount = Math.min(needed, l.free);
    draws.push({ lot: l.lot, location: l.location, amount_ul: amount / 1000 });
    needed -= amount;
  }
  return needed === 0 ? { compound: id, draws, reason: null } : none(P.codes.low);
}
const UNIT = { uL: ['µL', 1000, 3], mL: ['mL', 1000000, 6], nL: ['nL', 1, 0] }[P.unit];
const volume = (n) => String(Number((n / UNIT[1]).toFixed(UNIT[2]))) + ' ' + UNIT[0];
const written = (iso) => {
  const [y, m, d] = iso.split('-');
  if (P.dateForm === 'us') return Number(m) + '/' + Number(d) + '/' + y;
  if (P.dateForm === 'dmy') return d + '-' + MONTHS.slice(3 * (m - 1), 3 * m) + '-' + y;
  return iso;
};
function reservations(allocations) {
  const ids = holds().map((r) => r.reservation_id);
  const last = /^(.*?)(\\d+)$/.exec(ids[ids.length - 1]);
  const top = Math.max(...ids.map((id) => Number(/(\\d+)$/.exec(id)[1])));
  return allocations
    .flatMap((a) => a.draws.map((d) => ({ compound_id: a.compound, lot: d.lot, amount: volume(Math.round(d.amount_ul * 1000)) })))
    .map((r, i) => ({
      reservation_id: last[1] + String(top + i + 1).padStart(last[2].length, '0'),
      ...r,
      reserved_on: written(D),
    }));
}`;
}

const text = (value: unknown) => JSON.stringify(value);

export function usableCode(policy: Policy, day: string, compound: string): string {
  return `${helpers(policy, day)}
const lots = usable(${text(compound)});
({ compound: ${text(compound)}, usable_ul: lots.reduce((s, l) => s + l.free, 0) / 1000, lots: lots.map((l) => l.lot) })`;
}

export function pickCode(policy: Policy, day: string, compound: string): string {
  return `${helpers(policy, day)}
allocate(${text(compound)})`;
}

export function allocateCode(policy: Policy, day: string, compounds: readonly string[]): string {
  return `${helpers(policy, day)}
({ allocations: ${text(compounds)}.map(allocate) })`;
}

export function reserveCode(policy: Policy, day: string, compounds: readonly string[]): string {
  return `${helpers(policy, day)}
const allocations = ${text(compounds)}.map(allocate);
({ allocations, rows: reservations(allocations) })`;
}
