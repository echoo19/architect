import { describe, expect, it } from 'vitest';
import { applyEdits, blankHarness, diffHarness } from '../src';
import { sampleHarness } from './fixtures';

describe('diffHarness', () => {
  it('is empty for equal harnesses, whatever their version numbers', () => {
    const harness = sampleHarness();
    expect(diffHarness(harness, harness)).toEqual([]);
    expect(diffHarness(harness, { ...harness, meta: { ...harness.meta, version: 9 } })).toEqual([]);
  });

  it('reports an added file with a patch from /dev/null', () => {
    const before = sampleHarness();
    const after = applyEdits(before, [
      {
        op: 'write',
        path: 'skills/new-skill/SKILL.md',
        content: '---\nname: new-skill\ndescription: A new skill.\n---\nStep one.\n',
      },
    ]);
    expect(diffHarness(before, after)).toEqual([
      {
        path: 'skills/new-skill/SKILL.md',
        status: 'added',
        patch: [
          '--- /dev/null',
          '+++ b/skills/new-skill/SKILL.md',
          '@@ -0,0 +1,5 @@',
          '+---',
          '+name: new-skill',
          '+description: A new skill.',
          '+---',
          '+Step one.',
          '',
        ].join('\n'),
      },
    ]);
  });

  it('reports a modified file with three lines of context', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`);
    const before = { ...sampleHarness(), system: `${lines.join('\n')}\n` };
    const changed = [...lines];
    changed[5] = 'Line 6, rewritten';
    const after = { ...before, system: `${changed.join('\n')}\n` };
    const [diff] = diffHarness(before, after);
    expect(diff).toEqual({
      path: 'AGENTS.md',
      status: 'modified',
      patch: [
        '--- a/AGENTS.md',
        '+++ b/AGENTS.md',
        '@@ -3,7 +3,7 @@',
        ' Line 3',
        ' Line 4',
        ' Line 5',
        '-Line 6',
        '+Line 6, rewritten',
        ' Line 7',
        ' Line 8',
        ' Line 9',
        '',
      ].join('\n'),
    });
  });

  it('reports a deleted file with a patch to /dev/null', () => {
    const before = sampleHarness();
    const after = applyEdits(before, [
      { op: 'write', path: 'retrieval.yaml', content: 'rules: []\n' },
      { op: 'delete', path: 'examples/after-hours-plan-member.json' },
    ]);
    const diffs = diffHarness(before, after);
    const deleted = diffs.find((diff) => diff.status === 'deleted');
    expect(deleted?.path).toBe('examples/after-hours-plan-member.json');
    expect(
      deleted?.patch.startsWith(
        '--- a/examples/after-hours-plan-member.json\n+++ /dev/null\n@@ -1,',
      ),
    ).toBe(true);
    expect(deleted?.patch).toContain('-  "title": "After-hours job with a plan member",');
  });

  it('sorts by path and covers every kind of change at once', () => {
    const before = sampleHarness();
    const after = applyEdits(before, [
      { op: 'write', path: 'AGENTS.md', content: 'New prompt\n' },
      {
        op: 'write',
        path: 'skills/aaa/SKILL.md',
        content: '---\nname: aaa\ndescription: A\n---\n',
      },
      { op: 'delete', path: 'tools/invoice_total.js' },
      { op: 'delete', path: 'tools/invoice_total.json' },
    ]);
    expect(diffHarness(before, after).map(({ path, status }) => [path, status])).toEqual([
      ['AGENTS.md', 'modified'],
      ['skills/aaa/SKILL.md', 'added'],
      ['tools/invoice_total.js', 'deleted'],
      ['tools/invoice_total.json', 'deleted'],
    ]);
  });

  it('treats a settings file that appears or disappears as added or deleted', () => {
    const blank = blankHarness('Desk', 'About the desk.');
    const tuned = { ...blank, decoding: { ...blank.decoding, temperature: 0.4 } };
    expect(diffHarness(blank, tuned).map(({ path, status }) => [path, status])).toEqual([
      ['decoding.yaml', 'added'],
    ]);
    expect(diffHarness(tuned, blank).map(({ path, status }) => [path, status])).toEqual([
      ['decoding.yaml', 'deleted'],
    ]);
  });

  it('notes a missing final newline in the patch', () => {
    const before = { ...sampleHarness(), system: 'One\n' };
    const after = { ...before, system: 'One' };
    expect(diffHarness(before, after)[0]?.patch).toContain('\\ No newline at end of file');
  });
});
