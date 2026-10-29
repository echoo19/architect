import { describe, expect, it } from 'vitest';
import { agreed, currencyName, marksIn } from '../src/drafting/rule/currency';
import { readTable, kindOf, profileColumn, resolveDateOrder } from '../src/drafting/table';
import {
  addDays,
  cleanText,
  CURRENCY_CODE_LIST,
  CURRENCY_SIGN_CHARS,
  dateOrderEvidence,
  dayNumber,
  decimalToNumber,
  decimalToString,
  foldKey,
  isBlank,
  parseDay,
  parseDecimal,
  sumDecimals,
} from '../src/drafting/values';

/** A decimal as `units/places`, for a short expectation. */
function read(cell: string | null): string | null {
  const value = parseDecimal(cell);
  return value === null ? null : `${value.units}/${value.places}`;
}

describe('reading text', () => {
  it('makes odd spaces plain, runs of spaces one, and takes wrapping quotes off', () => {
    expect(cleanText('  North  ')).toBe('North');
    expect(cleanText('North\u{a0}\u{a0}Shore')).toBe('North Shore');
    expect(cleanText('Nor\u{200b}th')).toBe('North');
    expect(cleanText('"North"')).toBe('North');
    expect(cleanText('"  North  "')).toBe('North');
    expect(cleanText("'North'")).toBe('North');
    expect(cleanText('\u{201c}North\u{201d}')).toBe('North');
    expect(cleanText('\u{2018}North\u{2019}')).toBe('North');
    expect(cleanText('""North""')).toBe('North');
    expect(cleanText('Smith & Sons')).toBe('Smith & Sons');
    expect(cleanText('5" pipe')).toBe('5" pipe');
    expect(cleanText("'Cause")).toBe("'Cause");
    expect(cleanText(null)).toBe('');
    expect(cleanText('   ')).toBe('');
  });

  it('compares text without regard to case, spacing or quotes', () => {
    expect(foldKey(' "NORTH" ')).toBe(foldKey('north'));
    expect(foldKey('North Shore')).not.toBe(foldKey('Northshore'));
  });

  it('treats a mark for "nothing" in a column of numbers or dates as empty', () => {
    for (const mark of ['', ' ', 'N/A', 'n/a', 'NA', 'null', 'None', '-', '--', '?']) {
      expect(isBlank(mark)).toBe(true);
    }
    expect(isBlank(null)).toBe(true);
    expect(isBlank('0')).toBe(false);
    expect(isBlank('North')).toBe(false);
  });
});

describe('reading numbers', () => {
  it('reads currency signs, thousands separators, brackets and signs', () => {
    expect(read('12')).toBe('12/0');
    expect(read('12.50')).toBe('1250/2');
    expect(read('.5')).toBe('5/1');
    expect(read('12.')).toBe('12/0');
    expect(read('$12.50')).toBe('1250/2');
    expect(read('$ 1,234.50')).toBe('123450/2');
    expect(read('1,234')).toBe('1234/0');
    expect(read('1,234,567.8')).toBe('12345678/1');
    expect(read('(15.00)')).toBe('-1500/2');
    expect(read('-$12')).toBe('-12/0');
    expect(read('$-12')).toBe('-12/0');
    expect(read('12-')).toBe('-12/0');
    expect(read('\u{2212}12.5')).toBe('-125/1');
    expect(read('+7')).toBe('7/0');
    expect(read('USD 1,200')).toBe('1200/0');
    expect(read('1200 EUR')).toBe('1200/0');
    expect(read('\u{20ac}99.99')).toBe('9999/2');
    expect(read('  "1,250.00"  ')).toBe('125000/2');
  });

  it('takes off every currency code and sign that a rule recognises, so a cell it checks is a cell it reads', () => {
    // The two lists used to differ: KRW and RUB were recognised as currencies but left in the number.
    for (const code of CURRENCY_CODE_LIST) {
      expect(read(`${code} 1,200`), code).toBe('1200/0');
      expect(read(`1,200.50 ${code.toLowerCase()}`), code).toBe('120050/2');
      expect(marksIn(`${code} 1200`), code).toEqual([[code]]);
      expect(currencyName(code), code).not.toBe(code);
    }
    for (const sign of CURRENCY_SIGN_CHARS) {
      expect(read(`${sign}1,200`), sign).toBe('1200/0');
      expect(marksIn(`${sign}1200`), sign).toHaveLength(1);
    }
    expect(agreed(marksIn('KRW 1200'))).toEqual(['KRW']);
    expect(agreed(marksIn('\u{20a9}1200'))).toEqual(['KRW']);
    expect(agreed(marksIn('\u{20bd} 90'))).toEqual(['RUB']);
  });

  it('reads a decimal comma and spaced groups', () => {
    expect(read('12,5')).toBe('125/1');
    expect(read('12,50')).toBe('1250/2');
    expect(read('1.234,56')).toBe('123456/2');
    expect(read('1 234 567')).toBe('1234567/0');
    expect(read('1 234,50')).toBe('123450/2');
    expect(read("1'234.50")).toBe('123450/2');
  });

  it('keeps a lone point as a decimal point', () => {
    expect(read('1.234')).toBe('1234/3');
  });

  it('refuses what is not plainly a number', () => {
    for (const cell of [
      '',
      null,
      'abc',
      'twelve',
      '12 dollars',
      '12%',
      '1e3',
      '1.2.3',
      '1,23,456',
    ]) {
      expect(read(cell)).toBeNull();
    }
    expect(read('0.123456789')).toBeNull();
  });

  it('adds numbers of different places exactly', () => {
    const total = sumDecimals([parseDecimal('0.1')!, parseDecimal('0.2')!, parseDecimal('5')!]);
    expect(decimalToString(total)).toBe('5.3');
    expect(decimalToNumber(total)).toBe(5.3);
    expect(decimalToString(sumDecimals([]))).toBe('0');
    expect(decimalToString(sumDecimals([parseDecimal('-1.5')!, parseDecimal('1.5')!]))).toBe('0');
    expect(decimalToString(sumDecimals([parseDecimal('-0.05')!]))).toBe('-0.05');
    expect(decimalToString({ units: 1250n, places: 2 })).toBe('12.5');
    expect(decimalToString({ units: 5n, places: 3 })).toBe('0.005');
  });
});

describe('reading days', () => {
  it('reads the common ways to write a day', () => {
    const cases: [string, string][] = [
      ['2026-11-24', '2026-11-24'],
      ['2026-1-5', '2026-01-05'],
      ['2026/11/24', '2026-11-24'],
      ['20261124', '2026-11-24'],
      ['2026-11-24 09:30', '2026-11-24'],
      ['2026-11-24T09:30:00Z', '2026-11-24'],
      ['2026-11-24T09:30:00.250+02:00', '2026-11-24'],
      ['11/24/2026', '2026-11-24'],
      ['11-24-2026', '2026-11-24'],
      ['11/24/2026 1:05 PM', '2026-11-24'],
      ['Nov 24, 2026', '2026-11-24'],
      ['November 24, 2026', '2026-11-24'],
      ['nov. 24 2026', '2026-11-24'],
      ['Tue, Nov 24, 2026', '2026-11-24'],
      ['Tuesday, November 24th, 2026', '2026-11-24'],
      ['24 Nov 2026', '2026-11-24'],
      ['24-Nov-2026', '2026-11-24'],
      ['1st Dec 2026', '2026-12-01'],
      ['11/24/26', '2026-11-24'],
      ['11/24/95', '1995-11-24'],
    ];
    for (const [cell, day] of cases) expect(parseDay(cell, 'month_first'), cell).toBe(day);
  });

  it('reads 03/04/2026 as the order asked for, and points always day first', () => {
    expect(parseDay('03/04/2026', 'month_first')).toBe('2026-03-04');
    expect(parseDay('03/04/2026', 'day_first')).toBe('2026-04-03');
    expect(parseDay('24/11/2026', 'day_first')).toBe('2026-11-24');
    expect(parseDay('24/11/2026', 'month_first')).toBeNull();
    expect(parseDay('03.04.2026', 'month_first')).toBe('2026-04-03');
    expect(parseDay('24.11.2026', 'month_first')).toBe('2026-11-24');
  });

  it('refuses a day that is not on the calendar and text that is not a day', () => {
    for (const cell of [
      '2026-02-30',
      '2026-13-01',
      '13/45/2026',
      'soon',
      '',
      null,
      '2026',
      '12:30',
    ]) {
      expect(parseDay(cell, 'month_first'), String(cell)).toBeNull();
    }
    expect(parseDay('2024-02-29', 'month_first')).toBe('2024-02-29');
    expect(parseDay('2026-02-29', 'month_first')).toBeNull();
  });

  it('counts days and adds them', () => {
    expect(dayNumber('2026-11-24') - dayNumber('2026-11-01')).toBe(23);
    expect(addDays('2026-11-24', 7)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('finds what a column says about day and month order', () => {
    expect(dateOrderEvidence(['24/11/2026', '03/04/2026'])).toEqual({
      dayFirst: true,
      monthFirst: false,
      ambiguous: 1,
    });
    expect(dateOrderEvidence(['11/24/2026', null, '2026-11-24']).monthFirst).toBe(true);
    expect(dateOrderEvidence(['03/04/2026', '05/06/2026'])).toEqual({
      dayFirst: false,
      monthFirst: false,
      ambiguous: 2,
    });
    expect(dateOrderEvidence(['03.04.2026', '24.11.2026'])).toEqual({
      dayFirst: false,
      monthFirst: false,
      ambiguous: 0,
    });
  });

  it('settles the order from the cells, then from what was asked, then assumes month first', () => {
    expect(resolveDateOrder(['24/11/2026', '03/04/2026'], 'date', undefined)).toEqual({
      order: 'day_first',
      assumed: false,
    });
    expect(resolveDateOrder(['11/24/2026'], 'date', 'month_first')).toEqual({
      order: 'month_first',
      assumed: false,
    });
    expect(resolveDateOrder(['03/04/2026'], 'date', 'day_first')).toEqual({
      order: 'day_first',
      assumed: false,
    });
    expect(resolveDateOrder(['03/04/2026'], 'date', undefined)).toEqual({
      order: 'month_first',
      assumed: true,
    });
    expect(resolveDateOrder(['2026-11-24'], 'date', undefined)).toEqual({
      order: 'month_first',
      assumed: false,
    });
    expect(resolveDateOrder(['24/11/2026'], 'sent', 'month_first').problem).toContain(
      'day over 12 first',
    );
    expect(resolveDateOrder(['11/24/2026'], 'sent', 'day_first').problem).toContain(
      'day over 12 second',
    );
    expect(resolveDateOrder(['24/11/2026', '11/24/2026'], 'sent', undefined).problem).toContain(
      'some dates day first and some month first',
    );
  });
});

describe('reading a table', () => {
  it('reads a CSV and says what is wrong with one it cannot read', () => {
    const table = readTable('orders.csv', 'id,name\n1,"Ruiz, Ben"\n2,Cho\n');
    expect(table.columns).toEqual(['id', 'name']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.['name']).toBe('Ruiz, Ben');
    expect(() => readTable('orders.csv', 'id;name\n1;Ben\n')).toThrow(
      'orders.csv separates its columns with semicolons',
    );
    expect(() => readTable('orders.csv', 'id\tname\n1\tBen\n')).toThrow('with tabs');
    expect(() => readTable('orders.csv', 'id,name\n1\n')).toThrow("isn't a clean CSV file");
    expect(() => readTable('orders.csv', '')).toThrow("isn't a clean CSV file");
  });

  it('judges a column by nine in ten of its filled cells', () => {
    const numbers = Array.from({ length: 19 }, (_, index) => `$${index}.50`);
    expect(kindOf([...numbers, 'see note', null, 'N/A'])).toBe('number');
    expect(kindOf([...numbers.slice(0, 5), 'a', 'b', 'c', 'd', 'e'])).toBe('text');
    expect(kindOf(['2026-11-24', '11/25/2026', 'Nov 26, 2026'])).toBe('date');
    expect(kindOf([null, 'N/A'])).toBe('text');
  });

  it('profiles a column for the teacher', () => {
    const table = readTable(
      'orders.csv',
      [
        'id,region,amount',
        ...Array.from({ length: 30 }, (_, index) => {
          const region = ['North', 'south', 'EAST'][index % 3];
          return `ORD-${index},${region},${index === 5 ? '"$1,234.50"' : index}`;
        }),
      ].join('\n'),
    );
    const id = profileColumn(table, 'id');
    expect(id).toMatchObject({ kind: 'text', filled: 30, empty: 0, distinct: 30, unique: true });
    expect(id.samples).toHaveLength(5);
    const region = profileColumn(table, 'region');
    expect(region).toMatchObject({ distinct: 3, unique: false });
    expect(region.samples).toEqual(['North', 'south', 'EAST']);
    expect(profileColumn(table, 'amount')).toMatchObject({ kind: 'number', decorated: true });
  });
});
