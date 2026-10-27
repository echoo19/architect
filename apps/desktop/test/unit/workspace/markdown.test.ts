import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../../../src/renderer/src/workspace/markdown/Markdown';
import { parseInline, parseMarkdown } from '../../../src/renderer/src/workspace/markdown/parse';

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
const text = (value: string) => ({ type: 'text', text: value });

describe('parseInline', () => {
  it('reads bold, italic, strikethrough and code', () => {
    expect(parseInline('**$486.20** for *job* `4410` ~~draft~~')).toEqual([
      { type: 'strong', children: [text('$486.20')] },
      text(' for '),
      { type: 'em', children: [text('job')] },
      text(' '),
      { type: 'code', text: '4410' },
      text(' '),
      { type: 'del', children: [text('draft')] },
    ]);
  });

  it('nests emphasis and keeps code spans literal', () => {
    expect(parseInline('***both***')).toEqual([
      { type: 'strong', children: [{ type: 'em', children: [text('both')] }] },
    ]);
    expect(parseInline('**see `a*b*`**')).toEqual([
      { type: 'strong', children: [text('see '), { type: 'code', text: 'a*b*' }] },
    ]);
  });

  it('leaves underscores inside words and unmatched markers alone', () => {
    expect(parseInline('read_table on invoice_lines.csv')).toEqual([
      text('read_table on invoice_lines.csv'),
    ]);
    expect(parseInline('2 * 3 * 4 and **open')).toEqual([text('2 * 3 * 4 and **open')]);
    expect(parseInline('\\*not italic\\*')).toEqual([text('*not italic*')]);
  });

  it('turns line breaks inside a paragraph into breaks', () => {
    expect(parseInline('Ferncliff\n12 Alder St')).toEqual([
      text('Ferncliff'),
      { type: 'break' },
      text('12 Alder St'),
    ]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and reads headings and rules', () => {
    expect(parseMarkdown('# Totals\n\nFirst.\n\n---\nSecond.')).toEqual([
      { type: 'heading', level: 1, children: [text('Totals')] },
      { type: 'paragraph', children: [text('First.')] },
      { type: 'rule' },
      { type: 'paragraph', children: [text('Second.')] },
    ]);
  });

  it('reads bullet and numbered lists, nested ones and lists right after a paragraph', () => {
    const blocks = parseMarkdown(
      'Two jobs:\n- 4410: **$486.20**\n- 4412\n  - after hours\n  - plan member\n\n3. Tax\n4. Total',
    );
    expect(blocks).toEqual([
      { type: 'paragraph', children: [text('Two jobs:')] },
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          [
            {
              type: 'paragraph',
              children: [text('4410: '), { type: 'strong', children: [text('$486.20')] }],
            },
          ],
          [
            { type: 'paragraph', children: [text('4412')] },
            {
              type: 'list',
              ordered: false,
              start: 1,
              items: [
                [{ type: 'paragraph', children: [text('after hours')] }],
                [{ type: 'paragraph', children: [text('plan member')] }],
              ],
            },
          ],
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          [{ type: 'paragraph', children: [text('Tax')] }],
          [{ type: 'paragraph', children: [text('Total')] }],
        ],
      },
    ]);
  });

  it('keeps list items together across blank lines', () => {
    const [list] = parseMarkdown('1. Labor\n\n2. Parts\n\n   at cost plus 30%\n');
    expect(list).toMatchObject({ type: 'list', ordered: true });
    expect(list?.type === 'list' && list.items.length).toBe(2);
    expect(list?.type === 'list' && list.items[1]?.length).toBe(2);
  });

  it('reads fenced code as it is, even before the fence closes', () => {
    expect(parseMarkdown('```json\n{ "total_cents": 48620 }\n```')).toEqual([
      { type: 'code', lang: 'json', text: '{ "total_cents": 48620 }' },
    ]);
    expect(parseMarkdown('```\n**not bold**')).toEqual([
      { type: 'code', lang: '', text: '**not bold**' },
    ]);
  });

  it('reads GitHub tables with alignment and pads short rows', () => {
    expect(parseMarkdown('| Job | Total |\n|:--|--:|\n| 4410 | $486.20 |\n| 4412 |')).toEqual([
      {
        type: 'table',
        align: ['left', 'right'],
        head: [[text('Job')], [text('Total')]],
        rows: [
          [[text('4410')], [text('$486.20')]],
          [[text('4412')], []],
        ],
      },
    ]);
  });

  it('treats a line of dashes under plain text as a rule, not a table', () => {
    expect(parseMarkdown('Done\n---')).toEqual([
      { type: 'paragraph', children: [text('Done')] },
      { type: 'rule' },
    ]);
  });

  it('reads block quotes', () => {
    expect(parseMarkdown('> Net 30 days\n> from the invoice date')).toEqual([
      {
        type: 'quote',
        children: [
          {
            type: 'paragraph',
            children: [text('Net 30 days'), { type: 'break' }, text('from the invoice date')],
          },
        ],
      },
    ]);
  });
});

describe('Markdown', () => {
  it('shows raw HTML as text instead of running it', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="alert(2)">\n\n**<b>bold</b>**');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;');
    expect(out).toContain('<strong class="font-semibold">&lt;b&gt;bold&lt;/b&gt;</strong>');
  });

  it('escapes HTML inside code and tables too', () => {
    const out = html('`<i>x</i>`\n\n```\n</pre><script>\n```\n\n| a |\n|---|\n| <u>u</u> |');
    expect(out).toContain('&lt;i&gt;x&lt;/i&gt;');
    expect(out).toContain('&lt;/pre&gt;&lt;script&gt;');
    expect(out).toContain('&lt;u&gt;u&lt;/u&gt;');
    expect(out).not.toMatch(/<(i|u|script)>/);
  });

  it('renders lists, code and tables with the chat styles', () => {
    const out = html(
      '- one\n- two\n\n```\ncode\n```\n\n| Job | Total |\n|---|---|\n| 4410 | $486.20 |',
    );
    expect(out).toMatch(/<ul class="[^"]*list-disc[^"]*"><li/);
    expect(out).toContain('<pre class="');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('data-variant="card"');
    expect(out).toContain('$486.20');
  });

  it('starts numbered lists where the reply does', () => {
    expect(html('3. Tax\n4. Total')).toContain('<ol start="3"');
  });
});
