import { toCsv, writeDate } from '@architect/example-assay-desk';
import type { Random } from '@architect/example-assay-desk';
import type { Desk } from './build';
import { policyDocument } from './policy';
import { UNITS, writeVolume } from './volume';

/**
 * A lab's files as its store keeps them: inventory.csv, reservations.csv and policy.md. Dates are
 * written the lab's way, and volumes in its unit, except that some older inventory rows give
 * theirs in another unit; every one of them reads back to one volume.
 */

export const COLUMNS = {
  'inventory.csv': ['compound_id', 'lot', 'location', 'quantity', 'conc_mm', 'received', 'expires'],
  'reservations.csv': ['reservation_id', 'compound_id', 'lot', 'amount', 'reserved_on'],
} as const;

/** Rows at the top of inventory.csv that are always written plainly. */
export const PLAIN_ROWS = 5;
/** Share of the other rows whose quantity is written in another unit. */
const OTHER_SHARE = 0.15;

export function deskFiles(desk: Desk, random: Random): Map<string, string> {
  const { policy } = desk.style;
  const { lots, holds } = desk.store;
  const date = (day: string) => writeDate(day, policy.dateForm);
  const others = UNITS.filter((unit) => unit !== policy.unit);
  const files = new Map<string, string>();
  files.set(
    'inventory.csv',
    toCsv(
      COLUMNS['inventory.csv'],
      lots.map((lot, i) => {
        const unit =
          i >= PLAIN_ROWS && random.chance(OTHER_SHARE) ? random.pick(others) : policy.unit;
        return [
          lot.compound,
          lot.lot,
          lot.location,
          writeVolume(lot.quantity, unit),
          lot.concMm,
          date(lot.received),
          date(lot.expires),
        ];
      }),
    ),
  );
  files.set(
    'policy.md',
    policyDocument(desk.assay.name, desk.assay.today, policy, desk.style.policyStyle),
  );
  files.set(
    'reservations.csv',
    toCsv(
      COLUMNS['reservations.csv'],
      holds.map((h) => [
        h.id,
        h.compound,
        h.lot,
        writeVolume(h.amount, policy.unit),
        date(h.reservedOn),
      ]),
    ),
  );
  return files;
}
