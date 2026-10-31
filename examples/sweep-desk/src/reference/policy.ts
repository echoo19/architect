import { NUMBER_WORDS, SETTING_WORDS, SETTINGS } from '../group/policy';
import type { PolicyNumbers } from '../group/style';

/**
 * A group's rules read back from its policy.md, however it was written: from the table of
 * numbers at its end when it has one, else from what its sentences say. The metric names come
 * from the line that names them.
 */

export interface Policy extends PolicyNumbers {
  metrics: { train: string; val: string };
  /** The two-sided 95% t values the policy lists, for 1, 2, 3... degrees of freedom. */
  t: number[];
}

/** The t values after "degrees of freedom:", written `1: 12.706` or `one: 12.706`. */
function tValues(text: string): number[] {
  const list = /degrees of freedom: ((?:\w+: \d+\.\d+(?:, )?)+)/.exec(text);
  return list ? [...list[1]!.matchAll(/: (\d+\.\d+)/g)].map((m) => Number(m[1])) : [];
}

/** The first pattern that matches, and its groups. */
function find(text: string, what: string, patterns: readonly RegExp[]): string[] {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match.slice(1);
  }
  throw new Error(`policy.md doesn't say ${what}`);
}

const number = (word: string): number =>
  NUMBER_WORDS.includes(word) ? NUMBER_WORDS.indexOf(word) : Number(word);

const seedsIn = (list: string): number[] => (list.match(/\d+/g) ?? []).map(Number);

export function readPolicy(text: string): Policy {
  const [val, train] = find(text, 'the metric names', [
    /Validation loss is logged as `([^`]+)` and training loss as `([^`]+)`/,
  ]);
  const metrics = { train: train!, val: val! };
  const numbers = text.includes(`| ${SETTINGS.factor} `) ? readTable(text) : readProse(text);
  return { metrics, t: tValues(text), ...numbers };
}

function readTable(text: string): PolicyNumbers {
  const value = (setting: string): string => {
    const cells = text
      .split('\n')
      .map((row) => row.split('|').map((cell) => cell.trim()))
      .find((row) => row[0] === '' && row[1] === setting);
    if (cells === undefined) throw new Error(`policy.md has no row "${setting}"`);
    return cells[2]!;
  };
  const score = value(SETTINGS.score);
  const last = /last (\d+) evals/.exec(score);
  const interval = value(SETTINGS.interval);
  return {
    score: last ? { kind: 'last', k: Number(last[1]) } : { kind: 'min' },
    divergedSeeds: value(SETTINGS.divergedSeeds) === SETTING_WORDS.drop ? 'drop' : 'exclude',
    factor: Number(value(SETTINGS.factor)),
    patience: Number(value(SETTINGS.patience)),
    minDelta: Number(value(SETTINGS.minDelta)),
    interval: interval === SETTING_WORDS.t ? 't' : interval === SETTING_WORDS.se2 ? 'se2' : 'range',
    budget: Number(value(SETTINGS.budget)),
    seeds: seedsIn(value(SETTINGS.seeds)),
  };
}

function readProse(text: string): PolicyNumbers {
  const last = /over its last (\w+) evals/.exec(text);
  const [factor] = find(text, 'the divergence factor', [/goes above ([\d.]+) times its first/]);
  const [patience] = find(text, 'the patience', [/has gone (\w+) evals in a row/]);
  const delta = /lower than the best so far by more than ([\d.]+)\./.exec(text);
  const [budget] = find(text, 'the proposal budget', [/adds at most (\w+) runs/]);
  const [seeds] = find(text, 'the seeds', [/every one of our seeds, ([\d, and]+), so/]);
  return {
    score: last ? { kind: 'last', k: number(last[1]!) } : { kind: 'min' },
    divergedSeeds: /the config is ruled out/.test(text) ? 'exclude' : 'drop',
    factor: Number(factor),
    patience: number(patience!),
    minDelta: delta ? Number(delta[1]) : 0,
    interval: /t x sd/.test(text) ? 't' : /two standard errors/.test(text) ? 'se2' : 'range',
    budget: number(budget!),
    seeds: seedsIn(seeds!),
  };
}
