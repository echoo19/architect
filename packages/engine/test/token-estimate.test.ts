import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../src/agent/context';

/*
 * The fixtures are what the agent's tools printed for the returns desk's and home services' own
 * files, and a few texts that aren't English and numbers. `counts.json` holds their real sizes,
 * counted with Glimmer's own vocabulary:
 *
 *   llama-tokenize -m <the Glimmer 2-bit GGUF> -f <fixture> --no-bos --no-parse-special --show-count
 *
 * That reads the vocabulary only: no weights load and no model runs. Counted again for another
 * model, the constants in `agent/context.ts` are fitted again.
 */
interface Fixture {
  file: string;
  what: string;
  tokens: number;
}

const FOLDER = new URL('./fixtures/tokens/', import.meta.url);
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL('counts.json', FOLDER), 'utf8'));
const textOf = (fixture: Fixture) => readFileSync(new URL(fixture.file, FOLDER), 'utf8');

describe('counting tokens by characters', () => {
  it.each(fixtures)('is never under the real count: $what', (fixture) => {
    expect(estimateTokens(textOf(fixture))).toBeGreaterThanOrEqual(fixture.tokens);
  });

  it('stays close enough to leave room for work: at most twice the real count, a third over on the middle one', () => {
    const over = fixtures.map((fixture) => estimateTokens(textOf(fixture)) / fixture.tokens - 1);
    expect(Math.max(...over)).toBeLessThan(1);
    const middle = [...over].sort((a, b) => a - b)[Math.floor(over.length / 2)] ?? 0;
    expect(middle).toBeLessThan(0.5);
  });

  it('counts a table of ids and dates much higher than prose of the same length', () => {
    const table = textOf(fixtures.find((f) => f.file === 'returns-orders-read.txt')!);
    const prose = textOf(fixtures.find((f) => f.file === 'returns-policy-read.txt')!);
    const perCharacter = (text: string) => estimateTokens(text) / text.length;
    // The real counts say the same: 1.7 characters a token for the table, 3.5 for the prose.
    expect(perCharacter(table)).toBeGreaterThan(1.8 * perCharacter(prose));
  });

  it('counts a digit as a token, any other ASCII character as a third, and anything wider as a token', () => {
    // 1.1 is the margin counted on top.
    expect(estimateTokens('1234567890')).toBe(Math.ceil(10 * 1.1));
    expect(estimateTokens('abcdefghi')).toBe(Math.ceil(3 * 1.1));
    expect(estimateTokens('가나다')).toBe(Math.ceil(3 * 1.1));
    expect(estimateTokens('')).toBe(0);
  });
});
