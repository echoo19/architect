/**
 * The four research groups and how each keeps its runs. Every group runs the same kind of sweep
 * (a learning rate and a warmup length, several seeds), and each logs, names, stores and judges
 * its runs its own way, the way real groups' tooling differs.
 */

/** What an eval is counted in: training steps, or whole epochs. */
export type Axis = 'step' | 'epoch';

/** How policy.md is written: prose with its numbers in a table at the end, or prose alone. */
export type PolicyStyle = 'table' | 'prose';

/** How a paired difference's 95% interval is worked out. */
export type IntervalMethod = 't' | 'se2' | 'range';

/** The group's rules, as numbers. */
export interface PolicyNumbers {
  /** A run's score: the mean of its last `k` evals, or its lowest eval. */
  score: { kind: 'last'; k: number } | { kind: 'min' };
  /** A diverged seed is left out of its config's average, or rules the whole config out. */
  divergedSeeds: 'drop' | 'exclude';
  /** A run diverged when its training loss goes above this many times its first logged value. */
  factor: number;
  /** Evals in a row without improving that stop a run. */
  patience: number;
  /** How much lower than the best so far an eval must be to count as improving. */
  minDelta: number;
  interval: IntervalMethod;
  /** Runs one proposal round may add. */
  budget: number;
  /** The seeds every config runs with. */
  seeds: readonly number[];
}

/** An id format: a prefix and a zero-padded number, numbered on from `start` in shuffled order. */
export interface IdFormat {
  prefix: string;
  width: number;
  start: number;
}

export interface GroupStyle {
  id: string;
  name: string;
  /** The group's working date: its records end by it and its requests state it. */
  today: string;
  axis: Axis;
  /** Steps between evals (1 for an epoch group), and how many evals a full run logs. */
  interval: number;
  evals: number;
  /** Some runs log more often (every 100 steps): their interval, or null for an epoch group. */
  fineInterval: number | null;
  metrics: { train: string; val: string };
  /** The names of the two knobs in the group's configs and tables. */
  fields: { lr: string; warmup: string };
  /** Configs as columns of runs.csv, or in configs.json keyed by run id. */
  configs: 'columns' | 'json';
  /** How the group's tools spell a loss that is not a number, and one that is infinite. */
  nanForms: { nan: readonly string[]; inf: readonly string[] };
  /** The scheduler's words for how a run ended. */
  statuses: { ok: readonly string[]; failed: readonly string[]; killed: string };
  models: readonly string[];
  ids: { run: IdFormat; sweep: IdFormat; proposal: IdFormat; decision: IdFormat };
  policyStyle: PolicyStyle;
  policy: PolicyNumbers;
  /** The people who ask, by name. */
  people: readonly string[];
}

export const GROUPS: readonly GroupStyle[] = [
  {
    id: 'halden',
    name: 'Halden Lab',
    today: '2026-11-03',
    axis: 'step',
    interval: 500,
    evals: 12,
    fineInterval: 100,
    metrics: { train: 'train_loss', val: 'val_loss' },
    fields: { lr: 'lr', warmup: 'warmup' },
    configs: 'columns',
    nanForms: { nan: ['nan'], inf: ['inf'] },
    statuses: { ok: ['finished'], failed: ['failed', 'crashed'], killed: 'killed' },
    models: ['125M', '350M', '1.3B'],
    ids: {
      run: { prefix: 'hl-', width: 4, start: 400 },
      sweep: { prefix: 'sw-', width: 2, start: 11 },
      proposal: { prefix: 'P-', width: 3, start: 40 },
      decision: { prefix: 'D-', width: 3, start: 17 },
    },
    policyStyle: 'table',
    policy: {
      score: { kind: 'last', k: 3 },
      divergedSeeds: 'drop',
      factor: 3,
      patience: 4,
      minDelta: 0,
      interval: 't',
      budget: 6,
      seeds: [0, 1, 2],
    },
    people: ['Ines Kowal', 'Tobias Rennick', 'Mara Ojukwu'],
  },
  {
    id: 'quill',
    name: 'Quill Systems Group',
    today: '2026-10-20',
    axis: 'epoch',
    interval: 1,
    evals: 16,
    fineInterval: null,
    metrics: { train: 'train/loss', val: 'eval/loss' },
    fields: { lr: 'learning_rate', warmup: 'warmup_steps' },
    configs: 'json',
    nanForms: { nan: ['NaN'], inf: ['Infinity'] },
    statuses: { ok: ['FINISHED', 'COMPLETED'], failed: ['FAILED'], killed: 'PREEMPTED' },
    models: ['70M', '410M', '1.4B'],
    ids: {
      run: { prefix: 'run_', width: 3, start: 100 },
      sweep: { prefix: 'S', width: 3, start: 210 },
      proposal: { prefix: 'prop-', width: 4, start: 1200 },
      decision: { prefix: 'dec-', width: 2, start: 30 },
    },
    policyStyle: 'prose',
    policy: {
      score: { kind: 'min' },
      divergedSeeds: 'exclude',
      factor: 2,
      patience: 3,
      minDelta: 0.005,
      interval: 'se2',
      budget: 4,
      seeds: [1, 2, 3, 4],
    },
    people: ['Dara Fenwick', 'Joon Halverson', 'Priya Castellan'],
  },
  {
    id: 'marlow',
    name: 'Marlow Learning Group',
    today: '2026-11-11',
    axis: 'step',
    interval: 250,
    evals: 14,
    fineInterval: 100,
    metrics: { train: 'training_loss', val: 'validation_loss' },
    fields: { lr: 'learning_rate', warmup: 'warmup_steps' },
    configs: 'columns',
    nanForms: { nan: ['NaN', 'nan', '-nan'], inf: ['inf'] },
    statuses: { ok: ['done'], failed: ['crashed', 'error'], killed: 'cancelled' },
    models: ['160M', '1B'],
    ids: {
      run: { prefix: 'MLG', width: 5, start: 2600 },
      sweep: { prefix: 'sweep_', width: 1, start: 1 },
      proposal: { prefix: 'NR', width: 4, start: 300 },
      decision: { prefix: 'DL', width: 4, start: 80 },
    },
    policyStyle: 'prose',
    policy: {
      score: { kind: 'last', k: 5 },
      divergedSeeds: 'drop',
      factor: 1.5,
      patience: 5,
      minDelta: 0.01,
      interval: 'range',
      budget: 6,
      seeds: [13, 42, 77],
    },
    people: ['Owen Strand', 'Leila Moravec', 'Hugo Tanaka-Bell'],
  },
  {
    id: 'fennick',
    name: 'Fennick Research',
    today: '2026-10-28',
    axis: 'step',
    interval: 200,
    evals: 15,
    fineInterval: 100,
    metrics: { train: 'loss', val: 'val_loss' },
    fields: { lr: 'lr', warmup: 'warmup_steps' },
    configs: 'json',
    nanForms: { nan: ['nan'], inf: ['Infinity', 'inf'] },
    statuses: { ok: ['succeeded'], failed: ['failed'], killed: 'stopped' },
    models: ['125M', '760M', '1.3B'],
    ids: {
      run: { prefix: 'fr-', width: 4, start: 7000 },
      sweep: { prefix: 'FS-', width: 3, start: 50 },
      proposal: { prefix: 'Q', width: 3, start: 500 },
      decision: { prefix: 'log-', width: 3, start: 9 },
    },
    policyStyle: 'table',
    policy: {
      score: { kind: 'last', k: 4 },
      divergedSeeds: 'exclude',
      factor: 2.5,
      patience: 6,
      minDelta: 0.002,
      interval: 't',
      budget: 8,
      seeds: [7, 8, 9, 10],
    },
    people: ['Noor Abernathy', 'Felix Wren', 'Tamsin Ito'],
  },
];
