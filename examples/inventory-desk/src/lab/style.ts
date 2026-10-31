import type { Random } from '@architect/example-assay-desk';
import type { Policy, PolicyStyle } from './policy';
import { POLICY_STYLES } from './policy';
import { UNITS } from './volume';

/**
 * What makes one lab's compound store differ from another's besides its stock: how it names lots,
 * storage places and reservations, and its rules. The lab itself (its id, name, working day and
 * compounds) is the Assay desk's lab of the same id.
 */

export interface DeskStyle {
  /** The Assay desk lab this store belongs to. */
  id: string;
  lotId: (n: number) => string;
  /** Where the lot sits: a vial in a rack, a box in a freezer, a well of a source plate. */
  location: (random: Random) => string;
  reservationId: (n: number) => string;
  policy: Policy;
  policyStyle: PolicyStyle;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const ROWS = 'ABCDEFGHIJKLMNOP';

/** The four stores of the committed job, one for each Assay desk lab. */
export const DESK_STYLES: readonly DeskStyle[] = [
  {
    id: 'fenwick',
    lotId: (n) => `FL-${pad(2300 + n, 5)}`,
    location: (r) => `VR-${pad(r.int(1, 24), 2)}:${ROWS[r.int(0, 7)]}${pad(r.int(1, 12), 2)}`,
    reservationId: (n) => `HOLD-${pad(n, 4)}`,
    policy: {
      unit: 'uL',
      dateForm: 'iso',
      minimum: 20_000,
      cutoff: 30,
      choose: 'expiry',
      combine: false,
      maxHolds: 3,
      codes: { expired: 'EXPIRED', low: 'LOW-VOLUME', limit: 'MAX-HOLDS' },
    },
    policyStyle: 'table',
  },
  {
    id: 'alder-row',
    lotId: (n) => `LOT${700 + n * 3}`,
    location: (r) => `F${r.int(1, 4)}/Box${r.int(1, 40)}/${ROWS[r.int(0, 8)]}${r.int(1, 9)}`,
    reservationId: (n) => `R${500 + n}`,
    policy: {
      unit: 'mL',
      dateForm: 'us',
      minimum: 15_000,
      cutoff: 14,
      choose: 'largest',
      combine: true,
      maxHolds: 2,
      codes: { expired: 'exp', low: 'low', limit: 'cap' },
    },
    policyStyle: 'prose',
  },
  {
    id: 'saltmarsh',
    lotId: (n) => `SM-L${pad(n, 4)}`,
    location: (r) => `SRC-${pad(r.int(1, 60), 3)} ${ROWS[r.int(0, 15)]}${pad(r.int(1, 24), 2)}`,
    reservationId: (n) => `RS-${pad(n + 200, 4)}`,
    policy: {
      unit: 'nL',
      dateForm: 'dmy',
      minimum: 5_000,
      cutoff: 60,
      choose: 'expiry',
      combine: true,
      maxHolds: 4,
      codes: { expired: 'OUT-OF-DATE', low: 'SHORT', limit: 'LIMIT' },
    },
    policyStyle: 'bullets',
  },
  {
    id: 'corvid-hill',
    lotId: (n) => `CHL-${8000 + n * 7}`,
    location: (r) => `STORE${r.int(1, 6)}-SHELF${r.int(1, 12)}-${pad(r.int(1, 80), 2)}`,
    reservationId: (n) => `CH-H-${pad(n + 60, 4)}`,
    policy: {
      unit: 'uL',
      dateForm: 'iso',
      minimum: 12_000,
      cutoff: 21,
      choose: 'largest',
      combine: false,
      maxHolds: 5,
      codes: { expired: 'EXPIRING', low: 'INSUFFICIENT', limit: 'HOLD-LIMIT' },
    },
    policyStyle: 'bullets',
  },
];

/** A store of its own for any other lab, drawn from the same choices. */
export function randomStyle(id: string, random: Random): DeskStyle {
  const base = random.pick(DESK_STYLES);
  return {
    ...base,
    id,
    policy: {
      ...base.policy,
      unit: random.pick(UNITS),
      dateForm: random.pick(['iso', 'us', 'dmy'] as const),
      minimum: random.pick([5_000, 15_000, 20_000]),
      cutoff: random.pick([14, 30, 60]),
      choose: random.pick(['expiry', 'largest'] as const),
      combine: random.chance(0.5),
      maxHolds: random.pick([2, 3, 4]),
    },
    policyStyle: random.pick(POLICY_STYLES),
  };
}
