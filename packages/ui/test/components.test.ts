import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  BarChart,
  ChoiceTiles,
  cn,
  Combobox,
  DataTable,
  Disclosure,
  EvidenceMark,
  EvidenceMeter,
  evidenceLabel,
  Field,
  IntervalPlot,
  LineChart,
  Meter,
  niceCeiling,
  PageTabs,
  ProgressStepper,
  ProviderMark,
  RadioCard,
  RadioCardGroup,
  RiskCoveragePlot,
  riskTop,
  SettingsRow,
  Shortcut,
  spacedTicks,
  shortcutLabel,
  Spinner,
  stepPath,
  StepList,
  StepListItem,
  Switch,
  TooltipProvider,
} from '../src';

describe('Combobox', () => {
  it('shows the current choice on a named button that opens a list', () => {
    const html = renderToStaticMarkup(
      createElement(Combobox, {
        'aria-label': 'Mentor',
        value: 'meta::muse-spark-1.3',
        onValueChange: () => undefined,
        groups: [{ heading: 'Meta', options: [{ value: 'meta::muse-spark-1.3', label: 'Spark' }] }],
        children: 'Muse Spark 1.3',
      }),
    );
    expect(html).toContain('aria-label="Mentor"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Muse Spark 1.3');
  });
});

describe('ProviderMark', () => {
  it("shows the provider's initial, or an icon in its place, out of the reading order", () => {
    const html = renderToStaticMarkup(createElement(ProviderMark, { name: 'openrouter' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('>O</span>');
    const icon = renderToStaticMarkup(
      createElement(ProviderMark, { name: 'Ollama', icon: createElement('svg') }),
    );
    expect(icon).toContain('<svg></svg>');
  });
});

describe('cn', () => {
  it('resolves conflicts between the theme’s custom tokens', () => {
    expect(cn('text-small', 'text-body')).toBe('text-body');
    expect(cn('text-fg', 'text-fg-dim')).toBe('text-fg-dim');
    expect(cn('shadow-edge', 'shadow-float')).toBe('shadow-float');
    expect(cn('rounded-control', 'rounded-card')).toBe('rounded-card');
  });

  it('keeps a size and a color together', () => {
    expect(cn('text-fg', 'text-title')).toBe('text-fg text-title');
  });
});

describe('ProgressStepper', () => {
  it('marks earlier steps done and the current one as the step', () => {
    const html = renderToStaticMarkup(
      createElement(ProgressStepper, { steps: ['Describe', 'Define', 'Train'], current: 1 }),
    );
    expect(html).toContain('aria-label="Progress"');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>Define/);
    expect(html).toContain('Describe<span class="sr-only">, done</span>');
  });

  it('says a passed step still needs something, and only a passed one', () => {
    const html = renderToStaticMarkup(
      createElement(ProgressStepper, {
        steps: ['Package', 'Folders', 'Permissions', 'Install'],
        current: 3,
        attention: ['Folders', 'Install'],
      }),
    );
    expect(html).toContain('Folders<span class="sr-only">, needs attention</span>');
    expect(html).toContain('Package<span class="sr-only">, done</span>');
    expect(html).toContain('Permissions<span class="sr-only">, done</span>');
    // The step being worked on isn't passed yet, so it says nothing of the sort.
    expect(html).not.toContain('Install<span class="sr-only">');
  });
});

describe('Meter', () => {
  it('reports its value and clamps it', () => {
    const html = renderToStaticMarkup(
      createElement(Meter, { value: 1.4, label: 'Spark spending', valueText: '$7 of $5' }),
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuetext="$7 of $5"');
    expect(html).toContain('width:100%');
  });
});

describe('SettingsRow', () => {
  it('sets a fact on one line in the body face and a model id or path in mono', () => {
    const fact = renderToStaticMarkup(createElement(SettingsRow, { label: 'Rounds', meta: '12' }));
    expect(fact).toMatch(/truncate[^>]*>12</);
    expect(fact).not.toContain('font-mono');
    const code = renderToStaticMarkup(
      createElement(SettingsRow, { label: 'Mentor', meta: 'muse-spark-1.3', metaFont: 'code' }),
    );
    expect(code).toMatch(/font-mono[^>]*>muse-spark-1\.3/);
  });

  it('puts what the setting does behind an info icon named for the setting', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SettingsRow, { label: 'Rounds', info: 'Each round tries one change' }),
      ),
    );
    expect(html).toContain('aria-label="About Rounds"');
    // The sentence waits in the tooltip, never on the row.
    expect(html).not.toContain('Each round tries one change');
  });
});

describe('IntervalPlot', () => {
  it("sets a group's measured difference at its header's right", () => {
    const html = renderToStaticMarkup(
      createElement(IntervalPlot, {
        'aria-label': 'By organization',
        groups: [
          {
            label: 'Harborview Prep',
            end: '+39.6 points',
            rows: [{ id: 'a', label: 'Taught', estimate: 0.8, low: 0.7, high: 0.9 }],
          },
        ],
      }),
    );
    expect(html).toContain('+39.6 points');
    expect(html.indexOf('Harborview Prep')).toBeLessThan(html.indexOf('+39.6 points'));
    expect(html.indexOf('+39.6 points')).toBeLessThan(html.indexOf('Taught'));
  });
});

describe('Field', () => {
  it('marks an optional field after its label, and nothing else', () => {
    const html = renderToStaticMarkup(
      createElement(Field, { label: 'Notes', htmlFor: 'notes', optional: true, children: null }),
    );
    expect(html).toContain('Optional');
    expect(
      renderToStaticMarkup(
        createElement(Field, { label: 'Notes', htmlFor: 'notes', children: null }),
      ),
    ).not.toContain('Optional');
  });
});

describe('Spinner', () => {
  it('is decorative unless it has a label', () => {
    expect(renderToStaticMarkup(createElement(Spinner))).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(
      createElement(Spinner, { tone: 'mentor', label: 'Training' }),
    );
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Training"');
    expect(labelled).toContain('stroke-mentor');
  });
});

describe('shortcuts', () => {
  it('writes Mod as Command on macOS and Ctrl elsewhere', () => {
    expect(shortcutLabel('Mod', true)).toBe('⌘');
    expect(shortcutLabel('Mod', false)).toBe('Ctrl');
    expect(shortcutLabel('K', true)).toBe('K');
  });

  it('reads the full chord to assistive tech', () => {
    const mac = renderToStaticMarkup(createElement(Shortcut, { keys: ['Mod', 'K'], mac: true }));
    expect(mac).toContain('aria-label="Command+K"');
    expect(mac).toContain('>⌘</kbd>');
    const other = renderToStaticMarkup(createElement(Shortcut, { keys: ['Mod', ','], mac: false }));
    expect(other).toContain('aria-label="Ctrl+,"');
    expect(other).toContain('>Ctrl</kbd>');
  });
});

describe('EvidenceMeter', () => {
  it("draws each kind of result its own way, with the mentor's tick only when given", () => {
    const final = renderToStaticMarkup(
      createElement(EvidenceMeter, {
        kind: 'final',
        value: 0.5,
        label: 'Refunds, final test',
        valueText: '1 of 2 passed',
      }),
    );
    expect(final).toContain('data-kind="final"');
    expect(final).toContain('bg-student');
    expect(final).toContain('aria-valuetext="1 of 2 passed"');
    expect(final).not.toContain('data-marker');
    const practice = renderToStaticMarkup(
      createElement(EvidenceMeter, { kind: 'practice', value: 1, label: 'Refunds, practice' }),
    );
    expect(practice).toContain('bg-fg/60');
    expect(practice).not.toContain('gradient');
    const check = renderToStaticMarkup(
      createElement(EvidenceMeter, { kind: 'check', value: 1, label: 'Refunds', marker: 0.9 }),
    );
    expect(check).toContain('data-marker');
    expect(check).toContain('left:clamp(0px, calc(90% - 1.5px), calc(100% - 3px))');
  });

  it('names each kind with its own mark', () => {
    const html = renderToStaticMarkup(createElement(EvidenceMark, { kind: 'check' }));
    expect(html).toContain('Check tasks</span>');
    expect(evidenceLabel('practice')).toBe('Practice tasks');
    expect(evidenceLabel('install')).toBe('Works on this computer');
  });
});

describe('StepList', () => {
  it('opens the current step and lets only it take focus from Tab', () => {
    const html = renderToStaticMarkup(
      createElement(StepList, {
        'aria-label': 'Steps',
        count: 2,
        current: 1,
        onCurrentChange: () => undefined,
        children: [
          createElement(StepListItem, {
            key: 0,
            index: 0,
            line: 'Read data/orders.csv',
            children: 'first detail',
          }),
          createElement(StepListItem, {
            key: 1,
            index: 1,
            line: 'Answered',
            children: 'second detail',
          }),
        ],
      }),
    );
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/tabindex="0"[^>]*aria-current="step"/);
    expect(html).toContain('second detail');
    expect(html).not.toContain('first detail');
  });
});

describe('Disclosure', () => {
  it('keeps its content folded until opened', () => {
    const closed = renderToStaticMarkup(
      createElement(Disclosure, { label: 'Details', children: 'exp_1' }),
    );
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('exp_1');
    const open = renderToStaticMarkup(
      createElement(Disclosure, { label: 'Details', defaultOpen: true, children: 'exp_1' }),
    );
    expect(open).toContain('exp_1');
  });
});

describe('Switch', () => {
  const render = (checked: boolean, disabled?: boolean) =>
    renderToStaticMarkup(
      createElement(Switch, {
        'aria-label': 'Small tools',
        checked,
        onCheckedChange: () => undefined,
        ...(disabled === undefined ? {} : { disabled }),
      }),
    );

  it('keeps a switch that is held on at full strength, with a padlock on its knob', () => {
    const held = render(true, true);
    expect(held).toContain('role="switch"');
    expect(held).toContain('aria-checked="true"');
    expect(held).toContain('disabled=""');
    expect(held).toContain('lucide-lock');
    // It is not faded with the other controls that are unavailable: the track stays the on color.
    expect(held).toContain('disabled:data-[state=checked]:opacity-100');
    expect(held).toContain('data-[state=checked]:bg-primary');
  });

  it('shows the padlock only on a switch that is both on and held', () => {
    expect(render(true)).not.toContain('lucide-lock');
    expect(render(false)).not.toContain('lucide-lock');
    // A held switch that is off keeps fading, and has nothing to say it is locked on.
    const off = render(false, true);
    expect(off).not.toContain('lucide-lock');
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('disabled:opacity-40');
  });

  it('hides the padlock from a screen reader, which hears a switch that is on and unavailable', () => {
    const held = render(true, true);
    expect(held).toMatch(/<svg[^>]*lucide-lock[^>]*aria-hidden="true"/);
  });
});

describe('RadioCard', () => {
  const cards = createElement(
    Fragment,
    null,
    createElement(RadioCard, { value: 'here', title: 'Here', unavailable: true }, 'Too slow'),
    createElement(RadioCard, { value: 'there', title: 'There' }, 'Fine'),
  );
  const render = (value: string) =>
    renderToStaticMarkup(
      createElement(RadioCardGroup, {
        value,
        onValueChange: () => undefined,
        'aria-label': 'Where',
        children: cards,
      }),
    );

  it('goes quiet in the title of a card that cannot be chosen and is not', () => {
    const html = render('there');
    const title = html.slice(
      html.indexOf('<span', html.indexOf('>Here<') - 200),
      html.indexOf('>Here<'),
    );
    expect(title).toContain('group-data-[state=unchecked]:text-fg-dim');
    expect(html).toContain('data-state="unchecked"');
  });

  it('keeps the title of the card that is chosen in its normal color, though it cannot be chosen', () => {
    const html = render('here');
    const chosen = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
    expect(chosen).toContain('data-state="checked"');
    expect(chosen).toContain('disabled=""');
    // The quiet color is only for the card that is not chosen: a bare class would grey this one.
    expect(chosen).not.toMatch(/(?:^|[\s"])text-fg-dim/);
    // And a card that can be chosen is never quiet.
    const other = html.slice(html.lastIndexOf('<button'));
    expect(other).not.toContain('text-fg-dim');
  });
});

describe('PageTabs', () => {
  it("names its tabs, marks the open one, and shows only the open one's content", () => {
    const html = renderToStaticMarkup(
      createElement(PageTabs<'overview' | 'assets'>, {
        'aria-label': 'Field',
        tabs: [
          { value: 'overview', label: 'Overview' },
          { value: 'assets', label: 'Assets' },
        ],
        value: 'assets',
        onValueChange: () => undefined,
        children: 'The export',
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Field"');
    const assets = html.slice(html.lastIndexOf('<button'), html.lastIndexOf('</button>'));
    expect(assets).toContain('aria-selected="true"');
    expect(assets).toContain('Assets');
    expect(html).toContain('The export');
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
  });
});

describe('RiskCoveragePlot', () => {
  it('names itself, marks the certified point and the target, and keeps the top above the target', () => {
    const html = renderToStaticMarkup(
      createElement(RiskCoveragePlot, {
        'aria-label': 'Risk and coverage',
        points: [
          { coverage: 0.5, bound: 0.06, risk: 0 },
          { coverage: 0.8, bound: 0.09, risk: 0.02 },
          { coverage: 1, bound: 0.3, risk: 0.2 },
        ],
        chosen: 1,
        target: 0.1,
      }),
    );
    expect(html).toContain('aria-label="Risk and coverage"');
    expect(html).toContain('Certified');
    expect(html).toContain('Target');
    expect(html).toContain('bg-student');
    expect(riskTop(0.1)).toBe(0.3);
    expect(riskTop(0.5)).toBe(1);
  });

  it('draws no certified point without one', () => {
    const html = renderToStaticMarkup(
      createElement(RiskCoveragePlot, {
        'aria-label': 'Risk and coverage',
        points: [{ coverage: 0, bound: 1, risk: null }],
        target: 0.1,
      }),
    );
    expect(html).not.toContain('bg-student');
    expect(html).not.toContain('Certified');
  });
});

describe('ChoiceTiles', () => {
  it('marks a chosen tile with a check, not by its fill alone', () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceTiles<'a' | 'b'>, {
        multiple: true,
        'aria-label': 'Arms',
        value: ['a'],
        onValueChange: () => undefined,
        options: [
          { value: 'a', label: 'Chosen', icon: null },
          { value: 'b', label: 'Not chosen', icon: null },
        ],
      }),
    );
    const [chosen, other] = html.split('</button>');
    expect(chosen).toContain('lucide-circle-check');
    expect(other).not.toContain('lucide-circle-check');
  });
});

describe('DataTable', () => {
  it('keeps one fill on the selected row, pointed at or not', () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<{ id: string }>, {
        'aria-label': 'Rows',
        rows: [{ id: 'one' }, { id: 'two' }],
        rowKey: (row) => row.id,
        onRowClick: () => undefined,
        selectedKey: 'one',
        columns: [{ key: 'id', header: 'Id', cell: (row) => row.id }],
      }),
    );
    const rows = html.split('<tr').slice(2);
    expect(rows[0]).toContain('bg-selected');
    expect(rows[0]).not.toContain('hover:bg-hover');
    expect(rows[1]).toContain('hover:bg-hover');
  });
});

describe('LineChart', () => {
  const ticks = Array.from({ length: 13 }, (_, value) => ({ value, label: String(value) }));

  it('draws a main series in steps that hold each value until the next point', () => {
    expect(
      stepPath([
        { x: 0, y: 10 },
        { x: 5, y: 4 },
        { x: 9, y: 4 },
      ]),
    ).toBe('M0,10H5V4H9V4');
  });

  it('labels the x axis only as often as the labels fit, always the last', () => {
    expect(spacedTicks(ticks, 60).map((tick) => tick.value)).toHaveLength(13);
    expect(spacedTicks(ticks, 10).map((tick) => tick.value)).toEqual([0, 3, 6, 9, 12]);
  });

  it('reads out as its label, with its key and its reference level', () => {
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        label: 'Score by round: 40% at the start, 65% after round 1.',
        xMax: 12,
        xTicks: ticks,
        yRange: [30, 100],
        yTicks: [40, 60, 80, 100].map((value) => ({ value, label: `${value}%` })),
        series: [
          {
            id: 'checks',
            tone: 'student',
            main: true,
            points: [
              { x: 0, y: 40 },
              { x: 1, y: 65 },
            ],
          },
        ],
        marks: [{ key: 'r2', x: 2, y: 60, from: 65, kind: 'ring', tone: 'fg', title: 'Round 2' }],
        reference: { y: 90, label: 'Target 90%' },
        head: { x: 1, y: 65 },
        live: { x: 2, title: 'Round 2 in progress' },
        legend: [{ label: 'Held-out checks', tone: 'student', kind: 'main' }],
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Score by round: 40% at the start, 65% after round 1."');
    expect(html).toContain('Target 90%');
    expect(html).toContain('Held-out checks');
    expect(html).toContain('<title>Round 2 in progress</title>');
  });

  it('says so in the plot when there is nothing to draw', () => {
    const html = renderToStaticMarkup(
      createElement(LineChart, {
        label: 'Nothing measured yet.',
        xMax: 4,
        xTicks: ticks.slice(0, 5),
        yRange: [0, 100],
        yTicks: [],
        series: [],
        empty: 'Not scored yet',
      }),
    );
    expect(html).toContain('Not scored yet');
  });
});

describe('BarChart', () => {
  it('reads out each bar and draws an empty one as a mark on the baseline', () => {
    const html = renderToStaticMarkup(
      createElement(BarChart, {
        'aria-label': 'Requests per day',
        data: [
          { key: 'a', label: '30', description: 'October 30: 3 requests', value: 3 },
          { key: 'b', label: '31', description: 'October 31: no requests', value: 0 },
          {
            key: 'c',
            label: '1',
            description: 'November 1: 7 requests, 1 failed',
            value: 7,
            alert: 1,
          },
        ],
      }),
    );
    expect(html).toContain('aria-label="Requests per day"');
    expect(html).toContain('<li>October 30: 3 requests</li>');
    expect(html).toContain('<li>November 1: 7 requests, 1 failed</li>');
    // The scale tops out at 10, so the tallest bar fills 70% of it and its failure a seventh.
    expect(html).toContain('height:70%');
    expect(html).toContain('bg-danger');
    expect(html).toContain('h-0.5');
  });

  it('tops its scale at a round number', () => {
    expect([0, 1, 3, 7, 10, 11, 24, 51, 180].map(niceCeiling)).toEqual([
      1, 1, 5, 10, 10, 20, 50, 100, 200,
    ]);
  });
});
