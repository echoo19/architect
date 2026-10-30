import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, FOOTER } from '../src/content';
import { EXAMPLE, RULE_STEPS, stepPieces } from '../src/mock/repair-rule';
import { REPAIR_RUN } from '../src/results';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Numbers are held as whole ten-thousandths, so the working is exact and no float is involved. */
const SCALE = 10_000n;

function dec(text: string): bigint {
  const found = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (found === null) throw new Error(`Not a plain number: ${text}`);
  const [, whole = '0', fraction = ''] = found;
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0').slice(0, 4));
}

/** A number as the screen writes it: no trailing zeros. */
function plain(value: bigint): string {
  const fraction = (value % SCALE).toString().padStart(4, '0').replace(/0+$/, '');
  return fraction === '' ? `${value / SCALE}` : `${value / SCALE}.${fraction}`;
}

/** An amount of money as the example's answer is written: a sign and whole cents. */
function dollars(value: bigint): string {
  const cents = value / (SCALE / 100n);
  return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** The number a step says after some words, such as the 65 in "Multiply by 65.". */
function numberAfter(words: string, step: number): bigint {
  const text = RULE_STEPS[step]?.text ?? '';
  const found = new RegExp(`${words} ([0-9]+(?:\\.[0-9]+)?)`).exec(text);
  if (found?.[1] === undefined) throw new Error(`Step ${step + 1} has no number after "${words}".`);
  return dec(found[1]);
}

/** Up to the next multiple of a step, or to the nearest one with a tie going up. */
function roundTo(value: bigint, step: bigint, mode: 'up' | 'nearest'): bigint {
  const rest = value % step;
  if (rest === 0n) return value;
  const down = value - rest;
  return mode === 'up' || rest * 2n >= step ? down + step : down;
}

function input(label: string): string {
  const found = EXAMPLE.inputs.find((item) => item.label === label);
  if (found === undefined) throw new Error(`The example has no "${label}".`);
  return found.value;
}

describe('the rule chapter', () => {
  it('comes after the questions about the job and before training it', () => {
    const order = CHAPTERS.map((chapter) => chapter.id);
    expect(order.indexOf('ask')).toBe(order.indexOf('describe') + 1);
    expect(order.indexOf('rule')).toBe(order.indexOf('ask') + 1);
    expect(order.indexOf('train')).toBe(order.indexOf('rule') + 1);
  });

  it('sets only the file a step names in brackets apart, and loses none of its words', () => {
    for (const step of RULE_STEPS) {
      const pieces = stepPieces(step);
      expect(pieces.map((piece) => piece.text).join('')).toBe(step.text);
      expect(pieces.filter((piece) => piece.file).map((piece) => piece.text)).toEqual(
        (step.files ?? []).map((file) => `(${file})`),
      );
    }
  });

  it('works the example through its own steps, each line ending in the number so far', () => {
    // What the steps say to do, and the ticket's own cells: nothing is taken from the working.
    const multiple = numberAfter('multiple of', 0);
    const rate = numberAfter('Multiply by', 1);
    // A discount is said as the share taken off, as the app says it: 10% off is times 0.9.
    expect(RULE_STEPS[2]?.text).toMatch(/% off\.$/);
    const discount = SCALE - numberAfter('take', 2) / 100n;
    expect(RULE_STEPS[4]?.text).toContain('nearest cent');

    const hours = roundTo(dec(input('labor hours')), multiple, 'up');
    const labor = (hours * rate) / SCALE;
    const owed = input('member (customers.csv)') === 'yes' ? (labor * discount) / SCALE : labor;
    const total = owed + dec(input('parts cost'));
    const answer = roundTo(total, dec('0.01'), 'nearest');

    expect(EXAMPLE.lines.map((line) => line.value)).toEqual(
      [hours, labor, owed, owed, total, answer].map(plain),
    );
    expect(EXAMPLE.answer).toBe(dollars(answer));
  });
});

describe('what the page says about the repair shop', () => {
  it('tells that both shops are made up, and which of their parts are real', () => {
    expect(FOOTER.note).toContain('Both shops are made up.');
    expect(FOOTER.note).toContain("repair shop's rule and its run");
  });

  it("gives the run's figures as the README gives them, and says it was one run", () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    for (const figure of ['22 of 30', '40 of 40']) {
      expect(readme).toContain(figure);
      expect(REPAIR_RUN).toContain(figure);
    }
    expect(REPAIR_RUN).toContain('a single run, not a planned comparison');
    expect(REPAIR_RUN).toContain('online copy of Glimmer');
  });
});
