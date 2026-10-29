import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  cn,
  Combobox,
  Disclosure,
  EvidenceMark,
  EvidenceMeter,
  evidenceLabel,
  Meter,
  ProgressStepper,
  ProviderMark,
  RadioCard,
  RadioCardGroup,
  SettingsRow,
  Shortcut,
  shortcutLabel,
  Spinner,
  StepList,
  StepListItem,
  Switch,
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
    expect(cn('text-sm', 'text-chat')).toBe('text-chat');
    expect(cn('text-fg', 'text-fg-muted')).toBe('text-fg-muted');
    expect(cn('shadow-composer', 'shadow-modal')).toBe('shadow-modal');
    expect(cn('rounded-lg', 'rounded-6xl')).toBe('rounded-6xl');
  });

  it('keeps a size and a color together', () => {
    expect(cn('text-fg', 'text-display')).toBe('text-fg text-display');
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
    expect(html).not.toContain('Install<span');
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
  it('sets an explanation in the body face and a model id or path in mono', () => {
    const explained = renderToStaticMarkup(
      createElement(SettingsRow, { label: 'Rounds', meta: 'Each round tries one change' }),
    );
    expect(explained).toContain('Each round tries one change');
    expect(explained).not.toContain('font-mono');
    const code = renderToStaticMarkup(
      createElement(SettingsRow, { label: 'Mentor', meta: 'muse-spark-1.3', metaFont: 'code' }),
    );
    expect(code).toMatch(/font-mono[^>]*>muse-spark-1\.3/);
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
    expect(practice).toContain('repeating-linear-gradient');
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
    expect(title).toContain('group-data-[state=unchecked]:text-fg-muted');
    expect(html).toContain('data-state="unchecked"');
  });

  it('keeps the title of the card that is chosen in its normal color, though it cannot be chosen', () => {
    const html = render('here');
    const chosen = html.slice(html.indexOf('<button'), html.indexOf('</button>'));
    expect(chosen).toContain('data-state="checked"');
    expect(chosen).toContain('disabled=""');
    // The quiet color is only for the card that is not chosen: a bare class would grey this one.
    expect(chosen).not.toMatch(/(?:^|[\s"])text-fg-muted/);
    // And a card that can be chosen is never quiet.
    const other = html.slice(html.lastIndexOf('<button'));
    expect(other).not.toContain('text-fg-muted');
  });
});
