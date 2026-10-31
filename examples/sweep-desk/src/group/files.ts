import { toCsv } from '../lib/csv';
import type { CsvCell } from '../lib/csv';
import type { Random } from '../lib/random';
import type { Group } from './build';
import { policyDocument } from './policy';
import type { Run } from './rules';
import type { GroupStyle } from './style';

/**
 * A group's files as its tools export them. The records are the true ones; what differs is how
 * they are written. In about a fifth of the rows past the first five, metrics.csv writes a metric
 * name with other capitals, separators or spaces, and a loss in scientific notation, and runs.csv
 * or configs.json writes a learning rate another way (`3e-4`, `3.0e-04` for 0.0003). Some runs'
 * rows come newest first, as a resumed run's export does. Every form reads back to one value.
 */

/** Rows at the top of a table that are always written plainly, the sample rows a mentor sees. */
export const PLAIN_ROWS = 5;
/** The share of the other rows written another way. */
const OTHER_FORM = 0.2;
/** The share of runs whose rows metrics.csv lists newest first. */
const REVERSED = 0.12;

/** The kinds of other metric name, two per group. */
export const NAME_FORMS = ['upper', 'title', 'dash', 'space'] as const;
export type NameForm = (typeof NAME_FORMS)[number];

export function metricForm(name: string, form: NameForm): string {
  switch (form) {
    case 'upper':
      return name.toUpperCase();
    case 'title':
      return name.replace(
        /(^|[^a-z])([a-z])/g,
        (_, before: string, c: string) => before + c.toUpperCase(),
      );
    case 'dash':
      return name.includes('_') || name.includes('/') ? name.replace(/[_/]/g, '-') : `${name}-`;
    case 'space':
      return ` ${name}`;
  }
}

/** A learning rate the way a config writes it: 0.0003, 3e-4 or 3.0e-04. */
export function lrForm(lr: number, form: 'plain' | 'short' | 'long'): string {
  if (form === 'plain') return String(lr);
  const [mantissa, exponent] = lr.toExponential().split('e') as [string, string];
  if (form === 'short') return `${mantissa}e${exponent.replace('+', '')}`;
  const digits = exponent.replace(/^[+-]/, '').padStart(2, '0');
  return `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}e${exponent.startsWith('-') ? '-' : '+'}${digits}`;
}

/** A loss the way the tracker writes it: four decimals, scientific notation, or NaN and infinity. */
function lossText(value: number, style: GroupStyle, random: Random, other: boolean): string {
  if (Number.isNaN(value)) return random.pick(style.nanForms.nan);
  if (!Number.isFinite(value)) return random.pick(style.nanForms.inf);
  if (other && value >= 1 && value < 10) {
    const [mantissa, exponent] = value.toExponential(4).split('e') as [string, string];
    return `${mantissa}e${exponent[0]}${exponent.slice(1).padStart(2, '0')}`;
  }
  return String(value);
}

/** The grid as sweeps.csv writes it: `lr=1e-4/3e-4/1e-3/3e-3; warmup=0/500/2000`. */
function gridText(group: Group, grid: { lr: number[]; warmup: number[] }): string {
  const { fields } = group.style;
  return `${fields.lr}=${grid.lr.map((lr) => lrForm(lr, 'short')).join('/')}; ${fields.warmup}=${grid.warmup.join('/')}`;
}

export const COLUMNS = {
  'sweeps.csv': ['sweep_id', 'name', 'model', 'grid', 'baseline', 'started_on'],
  'metrics.csv': (style: GroupStyle) => ['run_id', style.axis, 'metric', 'value'],
  'runs.csv': (style: GroupStyle) =>
    style.configs === 'columns'
      ? ['run_id', 'sweep_id', style.fields.lr, style.fields.warmup, 'batch_size', 'seed', 'status']
      : ['run_id', 'sweep_id', 'seed', 'status'],
  'proposed_runs.csv': (style: GroupStyle) => [
    'proposal_id',
    'sweep_id',
    style.fields.lr,
    style.fields.warmup,
    'seed',
    'proposed_on',
  ],
  'decisions.csv': (style: GroupStyle) => [
    'decision_id',
    'sweep_id',
    'decided_on',
    style.fields.lr,
    style.fields.warmup,
    'decision',
  ],
} as const;

/** Every run of the group, in the order of their ids. */
export const runsOf = (group: Group): Run[] => group.sweeps.flatMap((s) => s.runs);

export function groupFiles(group: Group, random: Random): Map<string, string> {
  const { style } = group;
  const files = new Map<string, string>();
  files.set('policy.md', policyDocument(style));
  const batch = (run: Run) =>
    group.sweeps.find((s) => s.sweep_id === run.sweep_id)!.model.endsWith('B') ? 512 : 256;

  files.set(
    'sweeps.csv',
    toCsv(
      COLUMNS['sweeps.csv'],
      group.sweeps.map((s) => [
        s.sweep_id,
        s.name,
        s.model,
        gridText(group, s.grid),
        `${style.fields.lr}=${lrForm(s.baseline.lr, 'short')}; ${style.fields.warmup}=${s.baseline.warmup}`,
        s.started_on,
      ]),
    ),
  );

  const runs = runsOf(group);
  const lrForms = random.fork('lr');
  const lrText = (run: Run, i: number) =>
    lrForm(
      run.knobs.lr,
      i >= PLAIN_ROWS && lrForms.chance(OTHER_FORM)
        ? lrForms.pick(['short', 'long'] as const)
        : 'plain',
    );
  if (style.configs === 'columns') {
    files.set(
      'runs.csv',
      toCsv(
        COLUMNS['runs.csv'](style),
        runs.map((run, i) => [
          run.run_id,
          run.sweep_id,
          lrText(run, i),
          run.knobs.warmup,
          batch(run),
          run.seed,
          run.status,
        ]),
      ),
    );
  } else {
    files.set(
      'runs.csv',
      toCsv(
        COLUMNS['runs.csv'](style),
        runs.map((run) => [run.run_id, run.sweep_id, run.seed, run.status]),
      ),
    );
    const lines = runs.map(
      (run, i) =>
        `  "${run.run_id}": {"${style.fields.lr}": ${lrText(run, i)}, "${style.fields.warmup}": ${run.knobs.warmup}, "batch_size": ${batch(run)}, "optimizer": "adamw"}`,
    );
    files.set('configs.json', `{\n${lines.join(',\n')}\n}\n`);
  }

  // metrics.csv: per run, each eval's training loss then its validation loss.
  const forms = random.fork('forms');
  const nameForms = forms.sample(NAME_FORMS, 2);
  const order = random.fork('order');
  const rows: CsvCell[][] = [];
  for (const [index, run] of runs.entries()) {
    const evals = index > 0 && order.chance(REVERSED) ? [...run.evals].reverse() : run.evals;
    for (const e of evals) {
      for (const [metric, value] of [
        [style.metrics.train, e.train],
        [style.metrics.val, e.val],
      ] as const) {
        const other = rows.length >= PLAIN_ROWS && forms.chance(OTHER_FORM);
        const name =
          other && forms.chance(0.5) ? metricForm(metric, forms.pick(nameForms)) : metric;
        rows.push([
          run.run_id,
          e.at,
          name,
          lossText(value, style, forms, other && name === metric),
        ]);
      }
    }
  }
  files.set('metrics.csv', toCsv(COLUMNS['metrics.csv'](style), rows));

  files.set(
    'proposed_runs.csv',
    toCsv(
      COLUMNS['proposed_runs.csv'](style),
      group.proposals.map((p) => [
        p.proposal_id,
        p.sweep_id,
        String(p.knobs.lr),
        p.knobs.warmup,
        p.seed,
        p.proposed_on,
      ]),
    ),
  );
  files.set(
    'decisions.csv',
    toCsv(
      COLUMNS['decisions.csv'](style),
      group.decisions.map((d) => [
        d.decision_id,
        d.sweep_id,
        d.decided_on,
        String(d.knobs.lr),
        d.knobs.warmup,
        d.decision,
      ]),
    ),
  );
  return files;
}
