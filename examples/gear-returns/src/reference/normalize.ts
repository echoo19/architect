import { isIsoDate, MONTH_NAMES } from '../lib/calendar';
import { CATEGORIES } from '../shop/catalog';
import type { VariantKind } from '../shop/exports';
import type { Category, LegacyCode } from '../shop/types';

/**
 * Reading a value back from however a file wrote it, the way a careful person reads a messy
 * export: a date in any of the shop's forms becomes YYYY-MM-DD, money becomes whole cents, a SKU
 * or an email loses stray spaces and odd capitals, and an old category code becomes its category.
 * Each reader notes the kind of value it had to read back, so a reference solution can tell which
 * of its tasks turned on a value written another way.
 */
export class Reader {
  private readonly kinds = new Set<VariantKind>();

  /** The kinds of value read back from another form so far. */
  get variants(): ReadonlySet<VariantKind> {
    return this.kinds;
  }

  date(cell: CellText): string {
    const read = readDate(cell);
    if (cell !== read) this.kinds.add('date');
    return read;
  }

  optionalDate(cell: CellText): string | null {
    return cell === null ? null : this.date(cell);
  }

  money(cell: CellText): number {
    const cents = readMoney(cell);
    if (!/^\d+\.\d{2}$/.test(cell ?? '')) this.kinds.add('money');
    return cents;
  }

  sku(cell: CellText): string {
    const read = readSku(cell);
    if (cell !== read) this.kinds.add('sku');
    return read;
  }

  email(cell: CellText): string {
    const read = readEmail(cell);
    if (cell !== read) this.kinds.add('email');
    return read;
  }

  category(cell: CellText, codes: readonly LegacyCode[]): Category {
    const read = readCategory(cell, codes);
    if (cell !== read) this.kinds.add('category');
    return read;
  }
}

/** A cell as a row hands it over: text, null when empty, undefined when the column was not read. */
type CellText = string | null | undefined;

const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) => name.slice(0, 3));

/** YYYY-MM-DD, MM/DD/YYYY or "Nov 3, 2026", as YYYY-MM-DD. */
export function readDate(cell: CellText): string {
  const text = (cell ?? '').trim();
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const words = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(text);
  let date = text;
  if (slash) date = `${slash[3]}-${slash[1]}-${slash[2]}`;
  if (words) {
    const month = MONTH_ABBREVIATIONS.indexOf(words[1] as string) + 1;
    date = `${words[3]}-${String(month).padStart(2, '0')}-${(words[2] as string).padStart(2, '0')}`;
  }
  if (!isIsoDate(date)) throw new Error(`Not a date: ${JSON.stringify(cell)}`);
  return date;
}

/** "1234.50", "1234.5", "$1,234.50" or "1,234.50 USD", as whole cents (123450). */
export function readMoney(cell: CellText): number {
  const text = (cell ?? '')
    .trim()
    .replace(/^\$/, '')
    .replace(/ USD$/, '')
    .replace(/,(?=\d{3}(\D|$))/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Not an amount: ${JSON.stringify(cell)}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export function readSku(cell: CellText): string {
  const sku = (cell ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}-\d{4}$/.test(sku)) throw new Error(`Not a SKU: ${JSON.stringify(cell)}`);
  return sku;
}

export function readEmail(cell: CellText): string {
  const email = (cell ?? '').trim().toLowerCase();
  if (!/^[a-z]+\.[a-z]+@[a-z]+\.[a-z]+$/.test(email)) {
    throw new Error(`Not an email: ${JSON.stringify(cell)}`);
  }
  return email;
}

/** A category name as it is, or an old code through category_map.csv. */
export function readCategory(cell: CellText, codes: readonly LegacyCode[]): Category {
  const text = (cell ?? '').trim();
  const named = CATEGORIES.find((category) => category === text);
  if (named) return named;
  const code = codes.find((candidate) => candidate.legacy_code === text);
  if (!code) throw new Error(`Not a category or a known code: ${JSON.stringify(cell)}`);
  return code.category;
}
