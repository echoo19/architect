import { toCsv } from '../lib/csv';
import type { CsvCell } from '../lib/csv';
import type { Random } from '../lib/random';
import type { Lab, Plate } from './build';
import { policyDocument } from './policy';
import type { InstrumentId, LabStyle } from './style';

/**
 * A lab's files as its systems write them. plates.csv, compounds.csv and retests.csv are the
 * lab's own; each instrument writes its own export, with its own columns, its own way of naming
 * a well and a plate, and its own marks for a well with no reading. Some values are written
 * another way than the rest (a date, a well, a compound id, a reading), and every one of them
 * reads back to one value.
 */

/** The columns of each file the lab keeps, policy.md aside. */
export const COLUMNS = {
  'plates.csv': ['plate_id', 'layout', 'instrument', 'read_on', 'export_file'],
  'compounds.csv': ['plate_id', 'well', 'compound_id', 'conc_um'],
  'retests.csv': ['retest_id', 'plate_id', 'compound_id', 'reason', 'requested_on'],
} as const;

/** Each instrument: the file it exports to, its name in plates.csv, and its export's columns. */
export const EXPORTS: Record<InstrumentId, { file: string; name: string; columns: string[] }> = {
  lumen: { file: 'lumen_export.csv', name: 'Lumen 3', columns: ['Plate ID', 'Well', 'Counts'] },
  kestrel: {
    file: 'kestrel_export.csv',
    name: 'Kestrel HT',
    columns: ['Barcode', 'Row', 'Col', 'RFU'],
  },
  orbit: {
    file: 'orbit_export.csv',
    name: 'Orbit 2',
    columns: ['Plate', 'Well Position', 'Raw Signal'],
  },
};

/** How each instrument marks a well with no reading: an overflow, or nothing read. */
export const NO_READING: Record<InstrumentId, { overflow: string; blank: string }> = {
  lumen: { overflow: 'OVRFLW', blank: '' },
  kestrel: { overflow: 'OVER', blank: '-' },
  orbit: { overflow: 'Overflow', blank: 'NaN' },
};

/** Rows at the top of a big table that are always written plainly. */
export const PLAIN_ROWS = 5;
/** Share of the other rows written another way. */
const OTHER_SHARE = 0.18;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function writeDate(date: string, form: LabStyle['dateForm']): string {
  const [year, month, day] = date.split('-') as [string, string, string];
  if (form === 'iso') return date;
  if (form === 'us') return `${Number(month)}/${Number(day)}/${year}`;
  return `${day}-${MONTHS[Number(month) - 1]!}-${year}`;
}

export function writeLayout(layout: number, form: LabStyle['layoutForm']): string {
  return form === 'number' ? String(layout) : form === 'well' ? `${layout}-well` : `${layout}w`;
}

/** `C5`, or `C05` with the column in two digits. */
export function writeWell(well: string, padded: boolean): string {
  const [, row, column] = /^([A-P])(\d+)$/.exec(well)!;
  return padded ? `${row}${column!.padStart(2, '0')}` : well;
}

/** A whole number as an instrument writes it in scientific notation: 45123 as `4.5123E+04`. */
export function scientific(value: number): string {
  const digits = String(value).length;
  const mantissa = (value / 10 ** (digits - 1)).toFixed(digits - 1);
  return `${mantissa}E+${String(digits - 1).padStart(2, '0')}`;
}

/** With a thousands separator: 41234 as `41,234`. */
export function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+$)/g, ',');
}

export function labFiles(lab: Lab, random: Random): Map<string, string> {
  const { style, plates } = lab;
  const files = new Map<string, string>();
  files.set('policy.md', policyDocument(style.name, style.policy, style.policyStyle));
  files.set('plates.csv', platesCsv(style, plates, random.fork('plates')));
  files.set('compounds.csv', compoundsCsv(style, plates, random.fork('compounds')));
  for (const instrument of style.instruments) {
    const own = plates.filter((p) => p.instrument === instrument);
    files.set(EXPORTS[instrument].file, exportCsv(instrument, own, random.fork(instrument)));
  }
  files.set(
    'retests.csv',
    toCsv(
      COLUMNS['retests.csv'],
      lab.queue.map((r) => [r.id, r.plate, r.compound, r.reason, r.requestedOn]),
    ),
  );
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Whether row `index` of a table is written another way. */
function other(random: Random, index: number): boolean {
  return index >= PLAIN_ROWS && random.chance(OTHER_SHARE);
}

function platesCsv(style: LabStyle, plates: readonly Plate[], random: Random): string {
  const forms = (['iso', 'us', 'dmy'] as const).filter((form) => form !== style.dateForm);
  // Two plates after the first two have their date written another way.
  const odd = new Set(random.sample(plates.slice(2), 2));
  return toCsv(
    COLUMNS['plates.csv'],
    plates.map((plate) => [
      plate.id,
      writeLayout(plate.layout, style.layoutForm),
      EXPORTS[plate.instrument].name,
      writeDate(plate.readOn, odd.has(plate) ? random.pick(forms) : style.dateForm),
      EXPORTS[plate.instrument].file,
    ]),
  );
}

function compoundsCsv(style: LabStyle, plates: readonly Plate[], random: Random): string {
  const rows: CsvCell[][] = [];
  for (const plate of plates) {
    for (const well of plate.wells) {
      const index = rows.length;
      const padded = (style.wellForm === 'padded') !== other(random, index);
      let compound = well.compound;
      if (other(random, index)) {
        compound = random.chance(0.5) ? compound.toLowerCase() : ` ${compound}`;
      }
      const conc = well.role === 'compound' ? '10' : well.role === 'pos' ? '1' : null;
      rows.push([plate.id, writeWell(well.well, padded), compound, conc]);
    }
  }
  return toCsv(COLUMNS['compounds.csv'], rows);
}

function exportCsv(instrument: InstrumentId, plates: readonly Plate[], random: Random): string {
  const rows: CsvCell[][] = [];
  const marks = NO_READING[instrument];
  for (const plate of plates) {
    // The Kestrel reads a plate column by column; the others row by row.
    const wells =
      instrument === 'kestrel'
        ? [...plate.wells].sort((a, b) => columnOf(a.well) - columnOf(b.well))
        : plate.wells;
    for (const well of wells) {
      const index = rows.length;
      const odd = other(random, index);
      const value =
        well.signal === null
          ? random.chance(0.4)
            ? marks.overflow
            : marks.blank
          : writeReading(instrument, well.signal, odd);
      if (instrument === 'lumen') rows.push([plate.id, writeWell(well.well, true), value]);
      else if (instrument === 'orbit') rows.push([plate.id, well.well, value]);
      else {
        const barcode = plate.id.replace(/[^A-Za-z0-9]/g, '');
        const [, row, column] = /^([A-P])(\d+)$/.exec(well.well)!;
        rows.push([odd ? barcode.toLowerCase() : barcode, row!, Number(column), value]);
      }
    }
  }
  return toCsv(EXPORTS[instrument].columns, rows);
}

function writeReading(instrument: InstrumentId, signal: number, odd: boolean): string {
  if (instrument === 'kestrel') return signal.toFixed(1);
  if (!odd) return String(signal);
  return instrument === 'lumen' ? thousands(signal) : scientific(signal);
}

function columnOf(well: string): number {
  return Number(well.slice(1));
}
