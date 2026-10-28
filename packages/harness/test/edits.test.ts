import { GuardError, isHarnessSurfacePath } from '@architect/shared';
import type { FileEdit } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { applyEdits, hashHarness, HarnessValidationError } from '../src';
import { sampleHarness } from './fixtures';

const write = (path: string, content = 'x'): FileEdit => ({ op: 'write', path, content });
const remove = (path: string): FileEdit => ({ op: 'delete', path });

const skill = (name: string) => `---\nname: ${name}\ndescription: Does a thing.\n---\n1. Do it.\n`;

describe('edit paths', () => {
  it('accepts every file on the harness surface', () => {
    const harness = sampleHarness();
    for (const path of [
      'AGENTS.md',
      'skills/price-a-job/SKILL.md',
      'tools/invoice_total.js',
      'tools/invoice_total.json',
      'examples/after-hours-plan-member.json',
      'retrieval.yaml',
      'decoding.yaml',
      'guardrails.yaml',
    ]) {
      expect(isHarnessSurfacePath(path), path).toBe(true);
      expect(() => applyEdits(harness, [remove(path)]), path).not.toThrow(GuardError);
    }
  });

  const rejected = [
    // The shared contract's own list
    'harness.yaml',
    'checker.js',
    '../vault/test.jsonl',
    'skills/../../job.json',
    'tools/Invoice.js',
    'skills/a/b.md',
    'skills/a/skill.md',
    'skills/a/b/SKILL.md',
    'skills/SKILL.md',
    '/AGENTS.md',
    'data/invoices.csv',
    // Windows-style and mixed separators
    'skills\\price-a-job\\SKILL.md',
    'skills\\..\\..\\job.json',
    '..\\AGENTS.md',
    'skills/..\\AGENTS.md',
    'skills\\../AGENTS.md',
    'tools\\invoice_total.js',
    '\\AGENTS.md',
    'C:\\harness\\AGENTS.md',
    'C:/harness/AGENTS.md',
    'c:AGENTS.md',
    '\\\\server\\share\\AGENTS.md',
    '//server/share/AGENTS.md',
    // Other ways out of the folder or onto other files
    './harness.yaml',
    'skills/./../harness.yaml',
    'skills/..',
    '..',
    '.',
    '',
    'AGENTS.md/',
    'AGENTS.md ',
    ' AGENTS.md',
    'agents.md',
    'AGENTS.md\0.txt',
    'AGENTS.md:stream',
    'skills/price-a-job/SKILL.md/..',
    'skills/Price-A-Job/SKILL.md',
    'skills/price a job/SKILL.md',
    'tools/helper.py',
    'examples/x.md',
    'job.json',
    'checker/check.js',
    'vault/test.jsonl',
    // Names Windows would treat as devices
    'skills/con/SKILL.md',
    'tools/aux.js',
    'examples/nul.json',
    'skills/com1/SKILL.md',
    // The names format 1 used
    'system.md',
    'skills/price-a-job.md',
  ];

  it.each(rejected)('throws a harness_surface GuardError for %j', (path) => {
    const harness = sampleHarness();
    for (const edit of [write(path), remove(path)]) {
      try {
        applyEdits(harness, [edit]);
        expect.unreachable(`${edit.op} ${JSON.stringify(path)} was accepted`);
      } catch (error) {
        expect(error).toBeInstanceOf(GuardError);
        expect((error as GuardError).guard).toBe('harness_surface');
      }
    }
  });

  it('names the path in the message', () => {
    expect(() => applyEdits(sampleHarness(), [write('../vault/test.jsonl')])).toThrow(
      /"\.\.\/vault\/test\.jsonl"/,
    );
  });

  it("says where a format 1 file's content goes now", () => {
    expect(() => applyEdits(sampleHarness(), [write('system.md', 'Be brief.\n')])).toThrow(
      'Edit refused: "system.md" is an old name: the instructions live in AGENTS.md.',
    );
    expect(() => applyEdits(sampleHarness(), [write('skills/price-a-job.md')])).toThrow(
      'a skill is a folder, so write skills/price-a-job/SKILL.md',
    );
  });

  it('normalizes ./ and doubled slashes', () => {
    const edited = applyEdits(sampleHarness(), [
      write('./AGENTS.md', 'New prompt\n'),
      write('skills//new-skill/SKILL.md', skill('new-skill')),
    ]);
    expect(edited.system).toBe('New prompt\n');
    expect(edited.skills.map((item) => item.name)).toContain('new-skill');
  });

  it('applies nothing when one path in the set is refused', () => {
    const harness = sampleHarness();
    const before = hashHarness(harness);
    expect(() =>
      applyEdits(harness, [write('AGENTS.md', 'Changed\n'), write('..\\escape.md')]),
    ).toThrow(GuardError);
    expect(hashHarness(harness)).toBe(before);
  });
});

describe('applyEdits', () => {
  it('adds a skill, changes the instructions and removes an example', () => {
    const harness = sampleHarness();
    const edited = applyEdits(harness, [
      write('skills/new-skill/SKILL.md', skill('new-skill')),
      write('AGENTS.md', 'Be brief.\n'),
      remove('examples/after-hours-plan-member.json'),
      write(
        'retrieval.yaml',
        'max_loaded_skills: 1\nrules:\n  - when_any: [invoice]\n    load_skills: [new-skill]\n',
      ),
    ]);
    expect(edited.system).toBe('Be brief.\n');
    expect(edited.examples).toEqual([]);
    expect(edited.skills.map((item) => item.name)).toEqual([
      'new-skill',
      'overdue-balances',
      'price-a-job',
    ]);
    expect(edited.retrieval.rules[0]?.loadSkills).toEqual(['new-skill']);
  });

  it('adds a tool when both of its files are written', () => {
    const edited = applyEdits(sampleHarness(), [
      write(
        'tools/days_between.json',
        '{"name":"days_between","description":"Days between two dates.","parameters":{"type":"object","properties":{"from":{"type":"string"},"to":{"type":"string"}}}}',
      ),
      write('tools/days_between.js', 'function run(args, ctx) {\n  return 0;\n}\n'),
    ]);
    expect(edited.tools.map((tool) => tool.name)).toEqual(['days_between', 'invoice_total']);
  });

  it('does not change the harness it was given', () => {
    const harness = sampleHarness();
    const snapshot = structuredClone(harness);
    applyEdits(harness, [
      write('AGENTS.md', 'Other\n'),
      write('skills/extra/SKILL.md', skill('extra')),
    ]);
    expect(harness).toEqual(snapshot);
  });

  it('keeps the version and parent and refreshes the hash', () => {
    const harness = sampleHarness();
    const edited = applyEdits(harness, [write('AGENTS.md', 'Other\n')]);
    expect(edited.meta.version).toBe(harness.meta.version);
    expect(edited.meta.parent).toBe(harness.meta.parent);
    expect(edited.meta.hash).toBe(hashHarness(edited));
    expect(edited.meta.hash).not.toBe(harness.meta.hash);
  });

  it('applies edits in order, so a file can be written and then removed', () => {
    const harness = sampleHarness();
    const edited = applyEdits(harness, [
      write('skills/temp/SKILL.md', skill('temp')),
      remove('skills/temp/SKILL.md'),
    ]);
    expect(edited.skills).toEqual(harness.skills);
  });

  it('resets a settings file to its defaults when it is deleted', () => {
    const edited = applyEdits(sampleHarness(), [remove('decoding.yaml')]);
    expect(edited.decoding.temperature).toBe(1);
  });

  it('rejects deleting AGENTS.md', () => {
    expect(() => applyEdits(sampleHarness(), [remove('AGENTS.md')])).toThrow(
      /AGENTS\.md: cannot be deleted/,
    );
  });

  it('rejects an edit that leaves the harness invalid, naming the file', () => {
    try {
      applyEdits(sampleHarness(), [remove('skills/price-a-job/SKILL.md')]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessValidationError);
      expect((error as HarnessValidationError).errors).toEqual([
        'retrieval.yaml: rule 1 loads skill "price-a-job", but skills/price-a-job/SKILL.md does not exist.',
      ]);
    }
  });

  it('rejects deleting a file that is not there', () => {
    expect(() => applyEdits(sampleHarness(), [remove('skills/ghost/SKILL.md')])).toThrow(
      'skills/ghost/SKILL.md: cannot be deleted because it does not exist.',
    );
  });

  it('rejects half a tool', () => {
    expect(() => applyEdits(sampleHarness(), [remove('tools/invoice_total.js')])).toThrow(
      /tools\/invoice_total\.json: has no code/,
    );
  });

  it('rejects a skill with broken front matter', () => {
    expect(() =>
      applyEdits(sampleHarness(), [write('skills/broken/SKILL.md', 'Just text.\n')]),
    ).toThrow(/skills\/broken\/SKILL\.md: has no front matter/);
  });

  it("rejects a skill whose name isn't its folder's, or that has no description", () => {
    expect(() =>
      applyEdits(sampleHarness(), [write('skills/pricing/SKILL.md', skill('price-a-job'))]),
    ).toThrow(
      'skills/pricing/SKILL.md: name must match the folder, so it should be "pricing" (it is "price-a-job").',
    );
    expect(() =>
      applyEdits(sampleHarness(), [
        write('skills/brief/SKILL.md', '---\nname: brief\n---\nStep.\n'),
      ]),
    ).toThrow('skills/brief/SKILL.md: "description" is required');
    expect(() =>
      applyEdits(sampleHarness(), [
        write('skills/old/SKILL.md', '---\nname: old\nsummary: Old key.\n---\nStep.\n'),
      ]),
    ).toThrow(/unknown key "summary"/);
  });

  it('rejects writes that push the harness over the size limit', () => {
    expect(() =>
      applyEdits(sampleHarness(), [write('AGENTS.md', 'x'.repeat(256 * 1024 + 1))]),
    ).toThrow(/over the 256 KB limit/);
  });
});
