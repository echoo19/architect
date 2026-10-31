import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CapMeter,
  Card,
  CardGrid,
  CardRow,
  ChoiceTiles,
  columnGroups,
  DataTable,
  Inspector,
  IntervalPlot,
  Meter,
  NavItem,
  ToggleRow,
  intervalPercent,
  intervalText,
  readInspector,
  sortRows,
  TooltipProvider,
  type DataColumn,
} from '../src';

const icon = createElement('svg', { 'data-icon': true });

describe('NavItem', () => {
  const row = (props: Partial<Parameters<typeof NavItem>[0]>) =>
    renderToStaticMarkup(
      createElement(NavItem, { onClick: () => undefined, children: 'Models', ...props }),
    );

  it('marks the page on screen, and only that row', () => {
    expect(row({ current: true })).toContain('aria-current="page"');
    expect(row({})).not.toContain('aria-current');
  });

  it('draws the selected fill as the sliding piece when its rows share one', () => {
    const sliding = row({ current: true, indicator: 'sidebar' });
    expect(sliding).toMatch(/<span aria-hidden="true" class="absolute inset-0[^"]*bg-selected/);
    expect(sliding).not.toMatch(/<button[^>]*class="[^"]*bg-selected/);
    expect(row({ current: true })).toMatch(/<button[^>]*class="[^"]*bg-selected/);
  });

  it('keeps hover off the current row and on the others', () => {
    expect(row({ current: true, indicator: 'sidebar' })).not.toContain('hover:bg-hover');
    expect(row({})).toContain('hover:bg-hover');
  });
});

describe('Card and CardGrid', () => {
  it('names its region by its title and puts the action in the title row', () => {
    const html = renderToStaticMarkup(
      createElement(Card, {
        title: 'Needs you',
        icon,
        action: createElement('button', null, 'See all'),
        children: createElement('p', null, 'Spark asks'),
      }),
    );
    expect(html).toContain('aria-label="Needs you"');
    expect(html).toMatch(/<h2[^>]*>Needs you<\/h2><button>See all<\/button>/);
    expect(html).toContain('Spark asks');
    expect(html).toContain('rounded-card surface-card');
  });

  it('spans two columns when wide, and lays cards out in a grid', () => {
    const html = renderToStaticMarkup(
      createElement(CardGrid, {
        children: [
          createElement(Card, { key: 1, title: 'Running', wide: true, children: 'x' }),
          createElement(Card, { key: 2, title: 'Spend', children: 'y' }),
        ],
      }),
    );
    expect(html).toContain('grid grid-cols-1');
    expect(html.match(/lg:col-span-2/g)).toHaveLength(1);
  });

  it('makes a row a button only when it opens something', () => {
    const still = renderToStaticMarkup(
      createElement(CardRow, { title: 'Academy desk', end: '82%' }),
    );
    expect(still).not.toContain('<button');
    const opens = renderToStaticMarkup(
      createElement(CardRow, {
        title: 'Academy desk',
        onClick: () => undefined,
        label: 'Open Academy desk',
      }),
    );
    expect(opens).toContain('<button type="button" aria-label="Open Academy desk"');
  });
});

describe('Meter and CapMeter', () => {
  it('turns red and full past its cap', () => {
    const over = renderToStaticMarkup(createElement(Meter, { value: 1.2, label: 'Spark' }));
    expect(over).toContain('data-over="true"');
    expect(over).toContain('bg-danger');
    const under = renderToStaticMarkup(createElement(Meter, { value: 0.4, label: 'Spark' }));
    expect(under).not.toContain('data-over');
    expect(under).not.toContain('bg-danger');
  });

  it('reads an amount against its cap, and says when it went over', () => {
    const usd = (amount: number) => `$${amount.toFixed(2)}`;
    const within = renderToStaticMarkup(
      createElement(CapMeter, { label: 'Spark', used: 1.5, cap: 5, format: usd }),
    );
    expect(within).toContain('aria-valuetext="$1.50 of $5.00"');
    expect(within).not.toContain('text-danger');
    const over = renderToStaticMarkup(
      createElement(CapMeter, { label: 'Spark', used: 6, cap: 5, format: usd }),
    );
    expect(over).toContain('aria-valuetext="$6.00 of $5.00, over the cap"');
    expect(over).toContain('text-danger');
  });

  it('shows an amount with no cap recorded alone, with no meter', () => {
    const html = renderToStaticMarkup(
      createElement(CapMeter, { label: 'Glimmer', used: 0.42, format: (n: number) => `$${n}` }),
    );
    expect(html).toContain('$0.42');
    expect(html).not.toContain('role="meter"');
  });
});

describe('ToggleRow', () => {
  it('ties the label to the switch and sets the type at the right', () => {
    const html = renderToStaticMarkup(
      createElement(ToggleRow, {
        label: 'Instructions',
        type: 'Text',
        checked: true,
        onCheckedChange: () => undefined,
      }),
    );
    const id = /<button[^>]*id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/Instructions<\/label><span[^>]*>Text<\/span>/);
  });
});

describe('ChoiceTiles', () => {
  const options = [
    { value: 'spark', label: 'Spark', icon },
    { value: 'sol', label: 'Sol', icon },
    { value: 'astra', label: 'Astra', icon, disabled: true },
  ] as const;

  it('marks the one chosen tile in a single choice', () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceTiles<'spark' | 'sol' | 'astra'>, {
        'aria-label': 'Teacher',
        options,
        value: 'sol',
        onValueChange: () => undefined,
      }),
    );
    expect(html).toContain('aria-label="Teacher"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Sol</);
    expect(html).toContain('grid-cols-3');
  });

  it('marks every chosen tile in a multiple choice, and keeps a disabled one out', () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceTiles<'spark' | 'sol' | 'astra'>, {
        'aria-label': 'May change',
        multiple: true,
        options,
        value: ['spark', 'sol'],
        onValueChange: () => undefined,
        columns: 2,
      }),
    );
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toMatch(/disabled=""[^>]*>.*?Astra/);
    expect(html).toContain('grid-cols-2');
  });
});

describe('Inspector', () => {
  const tabs = [
    { value: 'teacher', label: 'Teacher', icon },
    { value: 'budget', label: 'Budget', icon },
  ] as const;

  it('opens on its first tab and shows that tab’s content', () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, {
        children: createElement(Inspector<'teacher' | 'budget'>, {
          'aria-label': 'Settings',
          tabs,
          children: (tab: string) => `content of ${tab}`,
        }),
      }),
    );
    expect(html).toContain('<aside aria-label="Settings"');
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>.*?Teacher/);
    expect(html).toContain('content of teacher');
    expect(html).toContain('aria-label="Fold Settings"');
  });

  it('opens on the tab the screen asks for, with room for five tabs by name', () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, {
        children: createElement(Inspector<'teacher' | 'budget'>, {
          'aria-label': 'Settings',
          tabs,
          tab: 'budget',
          children: (tab: string) => `content of ${tab}`,
        }),
      }),
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>.*?Budget/);
    expect(html).toContain('content of budget');
    expect(html).toContain('width:400px');
    // Every tab shows its name; none is reduced to its icon.
    expect(html).toContain('>Teacher</span>');
    expect(html).not.toContain('data-icon');
  });

  it('holds nothing while closed, and is hidden from assistive tech', () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, {
        children: createElement(Inspector<'teacher' | 'budget'>, {
          'aria-label': 'Settings',
          tabs,
          open: false,
          children: (tab: string) => `content of ${tab}`,
        }),
      }),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('content of');
  });

  it('shows what it is about above its tabs', () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, {
        children: createElement(Inspector<'teacher' | 'budget'>, {
          'aria-label': 'Model',
          tabs,
          header: createElement('h2', null, 'Academy desk v3'),
          children: (tab: string) => `content of ${tab}`,
        }),
      }),
    );
    expect(html).toMatch(/<h2>Academy desk v3<\/h2>.*role="tablist"/);
  });

  it('reads back the tab and fold it kept, and ignores what no longer fits', () => {
    const storage = (value: string | null) => ({ getItem: () => value });
    expect(readInspector(storage('{"tab":"budget","folded":true}'), 'define', tabs)).toEqual({
      tab: 'budget',
      folded: true,
    });
    expect(readInspector(storage('{"tab":"gone"}'), 'define', tabs)).toEqual({
      tab: undefined,
      folded: false,
    });
    expect(readInspector(storage('not json'), 'define', tabs)).toEqual({
      tab: undefined,
      folded: false,
    });
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readInspector(blocked, 'define', tabs).tab).toBeUndefined();
    expect(readInspector(undefined, 'define', tabs).folded).toBe(false);
  });
});

describe('IntervalPlot', () => {
  it('places values along the domain and holds them inside it', () => {
    expect(intervalPercent(0.5, [0, 1])).toBe(50);
    expect(intervalPercent(1.4, [0, 1])).toBe(100);
    expect(intervalPercent(-1, [0, 1])).toBe(0);
    expect(intervalPercent(30, [20, 40])).toBe(50);
  });

  it('reads each row as its value and interval, and an absent one as not measured', () => {
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    expect(
      intervalText({ id: 'a', label: 'Architect', estimate: 0.62, low: 0.48, high: 0.75 }, pct),
    ).toBe('62%, 95% interval 48% to 75%');
    expect(intervalText({ id: 'b', label: 'Bare', estimate: 0.3 }, pct)).toBe('30%');
    expect(intervalText({ id: 'c', label: 'Real', estimate: null }, pct)).toBe('not measured');
  });

  it('groups rows, draws nothing for an absent value and never a zero', () => {
    const html = renderToStaticMarkup(
      createElement(IntervalPlot, {
        'aria-label': 'Pass rate by arm',
        groups: [
          {
            label: 'Seen academies',
            rows: [{ id: 'a', label: 'Architect', estimate: 0.62, low: 0.48, high: 0.75 }],
          },
          { label: 'Real academy', rows: [{ id: 'b', label: 'Architect', estimate: null }] },
        ],
      }),
    );
    expect(html).toContain('<figure aria-label="Pass rate by arm"');
    expect(html).toContain('role="group" aria-label="Seen academies"');
    expect(html).toContain('62%, 95% interval 48% to 75%');
    expect(html).toContain('not measured');
    expect(html).toContain('>–</span>');
    expect(html).not.toContain('gradient');
  });
});

describe('DataTable', () => {
  interface Model {
    name: string;
    score: number | null;
  }
  const rows: Model[] = [
    { name: 'Academy desk', score: 0.8 },
    { name: 'Service desk', score: null },
    { name: 'Returns desk', score: 0.6 },
  ];
  const columns: DataColumn<Model>[] = [
    { key: 'name', header: 'Name', cell: (row) => row.name, sortValue: (row) => row.name },
    {
      key: 'score',
      header: 'Unseen',
      cell: (row) => (row.score === null ? null : `${row.score * 100}%`),
      sortValue: (row) => row.score,
      align: 'end',
    },
  ];

  it('sorts both ways and keeps absent values last', () => {
    const score = columns[1];
    expect(sortRows(rows, score, 'ascending').map((r) => r.name)).toEqual([
      'Returns desk',
      'Academy desk',
      'Service desk',
    ]);
    expect(sortRows(rows, score, 'descending').map((r) => r.name)).toEqual([
      'Academy desk',
      'Returns desk',
      'Service desk',
    ]);
    expect(sortRows(rows, undefined, 'ascending')).toEqual(rows);
  });

  it('shows an absent cell as absent, marks the sorted column and lets rows open', () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<Model>, {
        'aria-label': 'Models',
        columns,
        rows,
        rowKey: (row) => row.name,
        onRowClick: () => undefined,
        initialSort: { key: 'score', direction: 'descending' },
      }),
    );
    expect(html).toContain('aria-label="Models"');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('<span class="sr-only">None</span>');
    expect(html).not.toMatch(/>0%</);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html).toContain('sticky top-0');
  });

  it('heads side-by-side columns with their group, and keeps the open row selected', () => {
    const grouped: DataColumn<Model>[] = [
      columns[0] as DataColumn<Model>,
      { key: 'seen', header: 'Seen', cell: () => '90%', group: 'Final test' },
      { key: 'unseen', header: 'Unseen', cell: () => '83%', group: 'Final test' },
      { key: 'check', header: 'Check tasks', cell: () => '88%' },
    ];
    expect(columnGroups(grouped)).toEqual([
      { key: 'name', group: undefined, span: 1 },
      { key: 'seen', group: 'Final test', span: 2 },
      { key: 'check', group: undefined, span: 1 },
    ]);
    const html = renderToStaticMarkup(
      createElement(DataTable<Model>, {
        'aria-label': 'Models',
        columns: grouped,
        rows,
        rowKey: (row) => row.name,
        selectedKey: 'Academy desk',
      }),
    );
    expect(html).toMatch(/scope="colgroup" colSpan="2"[^>]*><span[^>]*>Final test<\/span>/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*class="[^"]*bg-selected/);
  });

  it('says what it shows when there are no rows', () => {
    const html = renderToStaticMarkup(
      createElement(DataTable<Model>, {
        'aria-label': 'Models',
        columns,
        rows: [],
        rowKey: (row) => row.name,
        empty: 'No models yet',
      }),
    );
    expect(html).toContain('No models yet');
  });
});
