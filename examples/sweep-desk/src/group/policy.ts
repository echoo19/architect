import { T_975 } from './rules';
import type { GroupStyle, IntervalMethod, PolicyNumbers } from './style';

/**
 * A group's policy.md: how it reads its runs and plans the next ones. Every group has the same
 * kinds of rule with its own numbers, written one of two ways: prose with the numbers in a table
 * at the end, or prose alone with the numbers in its sentences, some in words. The reference
 * reads the numbers back from either (`readPolicy` in src/reference/policy.ts).
 */

/** The rows of the table at the end of a `table` policy. */
export const SETTINGS = {
  val: 'Validation loss metric',
  train: 'Training loss metric',
  score: 'Run score',
  divergedSeeds: 'Seeds that diverged',
  factor: 'Divergence factor',
  patience: 'Early-stopping patience, in evals',
  minDelta: 'Smallest improvement',
  interval: 'Interval for a paired difference',
  budget: 'Runs per proposal round',
  seeds: 'Seeds',
} as const;

/** The table's words for each kind of rule. */
export const SETTING_WORDS = {
  min: 'lowest eval',
  last: (k: number) => `mean of the last ${k} evals`,
  drop: "left out of their config's mean",
  exclude: 'rule their config out',
  t: '95% t interval',
  se2: 'mean plus or minus two standard errors',
  range: 'smallest to largest difference',
} as const;

export const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

const word = (n: number): string => NUMBER_WORDS[n] ?? String(n);

export function policyDocument(style: GroupStyle): string {
  return `${(style.policyStyle === 'table' ? tablePolicy : prosePolicy)(style).join('\n')}\n`;
}

function files(style: GroupStyle): string[] {
  const unit = style.axis === 'step' ? 'step' : 'epoch';
  return [
    '## The files',
    '',
    '- `sweeps.csv`: each sweep, with its model, its grid (the values each knob may take) and its baseline config.',
    style.configs === 'columns'
      ? '- `runs.csv`: each run of a sweep, with its config, its seed and how the job ended.'
      : '- `runs.csv`: each run of a sweep, with its seed and how the job ended. Its config is in `configs.json`, by run id.',
    `- \`metrics.csv\`: every loss our tracker logged, by run, ${unit} and metric.`,
    '- `proposed_runs.csv`: the runs proposed for the next round. New rows go at the end.',
    '- `decisions.csv`: our decisions log. New rows go at the end.',
    '',
    '`status` in runs.csv is what the scheduler wrote when the job ended. It says nothing about whether a run diverged; that is decided from the losses alone, as below.',
  ];
}

function intervalText(method: IntervalMethod, numbers: (n: number) => string): string {
  const sd = 'sd being the standard deviation of the differences (dividing by n - 1)';
  switch (method) {
    case 't':
      return `the mean plus or minus t x sd / sqrt(n), ${sd} and t the two-sided 95% value for n - 1 degrees of freedom: ${T_975.slice(
        0,
        5,
      )
        .map((t, i) => `${numbers(i + 1)}: ${t}`)
        .join(', ')}`;
    case 'se2':
      return `the mean plus or minus two standard errors, 2 x sd / sqrt(n), ${sd}`;
    case 'range':
      return 'from the smallest difference to the largest, so every seed has to agree';
  }
}

/** The sections every policy shares; `n` writes a number the way the policy does. */
function rules(style: GroupStyle, n: (value: number) => string, inTable: boolean): string[] {
  const p = style.policy;
  const unit = style.axis === 'step' ? 'step' : 'epoch';
  const scoreRule = inTable
    ? p.score.kind === 'min'
      ? "A run's score is taken from its validation loss, as the table says: its lowest eval, or the mean of its last few evals (all of them if it logged fewer)."
      : "A run's score is taken from its validation loss, as the table says: the mean of its last few evals (all of them if it logged fewer), or its lowest eval."
    : p.score.kind === 'min'
      ? "A run's score is its lowest validation loss at any eval."
      : `A run's score is the mean of its validation loss over its last ${n(p.score.k)} evals, or all of them if it logged fewer.`;
  const divergedRule = inTable
    ? `A run diverged if its training loss is NaN or infinite at any eval, or goes above the divergence factor times its first logged training loss, the one at its earliest ${unit}.`
    : `A run diverged if its training loss is NaN or infinite at any eval, or goes above ${p.factor} times its first logged training loss, the one at its earliest ${unit}.`;
  const seedsRule = inTable
    ? "A seed that diverged is either left out of its config's mean, the config's score then being the mean of its other seeds, or rules its whole config out, as the table says. A config with no seed left has no score."
    : p.divergedSeeds === 'drop'
      ? "A seed that diverged is left out, and the config's score is the mean of its other seeds. A config whose every seed diverged has no score."
      : 'If any seed of a config diverged, the config is ruled out: it has no score and cannot be best.';
  const stopRule = inTable
    ? `We stop a run once its validation loss has gone the patience number of evals in a row without improving. An eval improves when it is lower than the best so far by more than the smallest improvement.`
    : p.minDelta === 0
      ? `We stop a run once its validation loss has gone ${n(p.patience)} evals in a row without improving. An eval improves when it is lower than the best so far.`
      : `We stop a run once its validation loss has gone ${n(p.patience)} evals in a row without improving. An eval improves when it is lower than the best so far by more than ${p.minDelta}.`;
  const interval = inTable
    ? `the interval the table names: a 95% t interval is ${intervalText('t', String)}; two standard errors is ${intervalText('se2', String)}; smallest to largest runs ${intervalText('range', String)}`
    : intervalText(p.interval, n);
  const budget = inTable
    ? "A proposal round adds at most the table's runs per round to proposed_runs.csv."
    : `A proposal round adds at most ${n(p.budget)} runs to proposed_runs.csv.`;
  const seeds = inTable
    ? 'Each config goes in with every one of our seeds (the table lists them)'
    : `Each config goes in with every one of our seeds, ${seedList(p.seeds)}`;
  return [
    '## Evals',
    '',
    `An eval is one logged validation loss. Evals are counted in ${unit}s and taken in order of ${unit}, however often a run logged.`,
    '',
    "## A run's score",
    '',
    scoreRule,
    '',
    '## Divergence',
    '',
    divergedRule,
    '',
    '## The best config',
    '',
    `A config is a learning rate and a warmup length; its runs are its seeds. A config's score is the mean of its seeds' run scores. ${seedsRule} The best config of a sweep is the one with the lowest score.`,
    '',
    '## Early stopping',
    '',
    `${stopRule} The run stops at the eval that makes it ${inTable ? 'that many' : n(p.patience)} in a row, and its best eval is the best so far at that point. If that never happens the run goes to its end, and stops at its last eval.`,
    '',
    '## Did a change help',
    '',
    `Compare the config with the change against the config without it, seed by seed. Pair the two configs' runs that have the same seed, leaving out a seed either config lacks and a seed where either run diverged. Each difference is the run score without the change minus the run score with it, so a difference above zero means the change lowered the loss. With n pairs, the mean difference is their mean, and the 95% interval is ${interval}. The change helped if the whole interval is above zero and hurt if it is all below zero; otherwise it is unclear. Fewer than two pairs is no comparison.`,
    '',
    '## Proposing the next runs',
    '',
    `${budget} Propose configs one grid step from the sweep's best config: one knob moved to the next value up or down on the sweep's grid, the other kept. Leave out a config the sweep has run with any seed and one an earlier row of proposed_runs.csv names for the sweep. ${seeds}, so a round proposes as many whole configs as fit in it, or every config that qualifies when there are fewer. Number the rows on from the last proposal_id, and date them with today's date.`,
    '',
    '## Writing up a sweep',
    '',
    "A sweep report gives the best config with its score, the runs that diverged, and how the best config compares with the sweep's baseline from sweeps.csv, the baseline being the config without the change. Record it in decisions.csv: one row, numbered on from the last decision_id, dated today, with the best config's values and the decision, `adopt` when the best config helped against the baseline and `keep` otherwise.",
    '',
    '## Numbers',
    '',
    'Give losses and differences to three decimals.',
  ];
}

function seedList(seeds: readonly number[]): string {
  return `${seeds.slice(0, -1).join(', ')} and ${seeds.at(-1)!}`;
}

function header(style: GroupStyle): string[] {
  return [
    `# ${style.name}: reading our runs`,
    '',
    `This is how ${style.name} reads its training runs and plans the next ones. Sweep desk, our assistant, follows it, and so do we.`,
    '',
    `Validation loss is logged as \`${style.metrics.val}\` and training loss as \`${style.metrics.train}\`.`,
    '',
  ];
}

function tablePolicy(style: GroupStyle): string[] {
  const p: PolicyNumbers = style.policy;
  const rows: [string, string][] = [
    [SETTINGS.val, `\`${style.metrics.val}\``],
    [SETTINGS.train, `\`${style.metrics.train}\``],
    [SETTINGS.score, p.score.kind === 'min' ? SETTING_WORDS.min : SETTING_WORDS.last(p.score.k)],
    [SETTINGS.divergedSeeds, SETTING_WORDS[p.divergedSeeds]],
    [SETTINGS.factor, String(p.factor)],
    [SETTINGS.patience, String(p.patience)],
    [SETTINGS.minDelta, String(p.minDelta)],
    [SETTINGS.interval, SETTING_WORDS[p.interval]],
    [SETTINGS.budget, String(p.budget)],
    [SETTINGS.seeds, p.seeds.join(', ')],
  ];
  const width = Math.max(...rows.map(([s]) => s.length));
  const valueWidth = Math.max(...rows.map(([, v]) => v.length));
  const line = (a: string, b: string) => `| ${a.padEnd(width)} | ${b.padEnd(valueWidth)} |`;
  return [
    ...header(style),
    ...files(style),
    '',
    ...rules(style, String, true),
    '',
    '## Our numbers',
    '',
    line('Setting', 'Value'),
    `| ${'-'.repeat(width)} | ${'-'.repeat(valueWidth)} |`,
    ...rows.map(([s, v]) => line(s, v)),
  ];
}

function prosePolicy(style: GroupStyle): string[] {
  return [...header(style), ...files(style), '', ...rules(style, word, false)];
}
