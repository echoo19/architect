import { describe, expect, it } from 'vitest';
import { blankHarness, hashFiles, hashHarness, harnessToFiles } from '../src';
import { sampleHarness } from './fixtures';

describe('hashHarness', () => {
  it('is sha256- followed by 64 hex digits', () => {
    expect(hashHarness(sampleHarness())).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('gives the same value on every platform', () => {
    // Pinned so a change in file layout, newline handling or path order shows up here.
    expect(hashHarness(sampleHarness())).toBe(
      'sha256-3773884bda9cc42bbd8401ddbf96fc893069a8651b0c62c13d5a7f6167ae4bb5',
    );
  });

  it('ignores harness.yaml, so version, parent, name and the hash itself do not matter', () => {
    const harness = sampleHarness();
    const renumbered = {
      ...harness,
      meta: { ...harness.meta, name: 'Other name', version: 99, parent: 98, hash: 'whatever' },
    };
    expect(hashHarness(renumbered)).toBe(hashHarness(harness));
    expect(hashFiles({ ...harnessToFiles(harness), 'harness.yaml': 'format: 1\n' })).toBe(
      hashHarness(harness),
    );
  });

  it('does not depend on key order inside tool schemas or example arguments', () => {
    const harness = sampleHarness();
    const tool = harness.tools[0];
    const example = harness.examples[0];
    if (!tool || !example) throw new Error('fixture has a tool and an example');
    const reordered = {
      ...harness,
      tools: [
        {
          ...tool,
          parameters: {
            required: ['lines'],
            properties: { lines: { items: { type: 'object' }, type: 'array' } },
            type: 'object' as const,
          },
        },
      ],
      examples: [
        {
          ...example,
          messages: example.messages.map((message) =>
            message.role === 'assistant' && message.toolCalls
              ? {
                  ...message,
                  toolCalls: message.toolCalls.map((call) => ({
                    ...call,
                    arguments: { where: { id: 'J-100' }, name: 'jobs' },
                  })),
                }
              : message,
          ),
        },
      ],
    };
    expect(hashHarness(reordered)).toBe(hashHarness(harness));
  });

  it('does not depend on the order skills were listed in', () => {
    const harness = sampleHarness();
    expect(hashHarness({ ...harness, skills: [...harness.skills].reverse() })).toBe(
      hashHarness(harness),
    );
  });

  it('does not depend on line endings', () => {
    const harness = sampleHarness();
    const crlf = { ...harness, system: harness.system.replace(/\n/g, '\r\n') };
    expect(hashHarness(crlf)).toBe(hashHarness(harness));
    expect(hashFiles({ 'system.md': 'a\r\nb\r\n' })).toBe(hashFiles({ 'system.md': 'a\nb\n' }));
  });

  it('treats default settings the same whether or not their files exist', () => {
    const blank = blankHarness('Desk', 'About the desk.');
    expect(hashHarness({ ...blank, decoding: { ...blank.decoding } })).toBe(hashHarness(blank));
  });

  it('changes when any part of the content changes', () => {
    const harness = sampleHarness();
    const base = hashHarness(harness);
    const skill = harness.skills[0];
    const tool = harness.tools[0];
    if (!skill || !tool) throw new Error('fixture has a skill and a tool');
    const changed = [
      { ...harness, system: `${harness.system}More.\n` },
      {
        ...harness,
        skills: [{ ...skill, body: `${skill.body}3. New step.\n` }, ...harness.skills.slice(1)],
      },
      { ...harness, tools: [{ ...tool, code: `${tool.code}// edited\n` }] },
      { ...harness, decoding: { ...harness.decoding, temperature: 0.2 } },
      { ...harness, retrieval: { ...harness.retrieval, maxExamples: 2 } },
      { ...harness, guardrails: { refuse: [] } },
      { ...harness, examples: [] },
    ];
    const hashes = changed.map(hashHarness);
    expect(new Set([base, ...hashes]).size).toBe(changed.length + 1);
  });

  it('cannot be fooled by moving text between a path and its content', () => {
    expect(hashFiles({ 'a.md': 'b\n1\nc' })).not.toBe(hashFiles({ 'a.md': 'b', 'c.md': '' }));
    expect(hashFiles({ 'skills/a.md': 'x', 'skills/b.md': 'y' })).not.toBe(
      hashFiles({ 'skills/a.md': 'xy', 'skills/b.md': '' }),
    );
  });
});
