import { describe, expect, it } from 'vitest';
import { harnessToFiles, validateHarnessFiles } from '../src';
import { sampleHarness } from './fixtures';

const base = (): Record<string, string> => harnessToFiles(sampleHarness());

function errorsFor(files: Record<string, string>): string[] {
  const result = validateHarnessFiles(files);
  if (result.ok) throw new Error('expected the files to be rejected');
  return result.errors;
}

describe('validateHarnessFiles', () => {
  it('accepts a complete harness, with or without harness.yaml', () => {
    const harness = sampleHarness();
    const bare = validateHarnessFiles(base());
    expect(bare.ok).toBe(true);
    const withMeta = validateHarnessFiles({
      ...base(),
      'harness.yaml': 'format: 1\nname: Service desk\nversion: 3\nparent: 2\nhash: sha256-x\n',
    });
    expect(withMeta.ok && withMeta.harness.meta).toEqual({
      format: 1,
      name: 'Service desk',
      version: 3,
      parent: 2,
      hash: 'sha256-x',
    });
    expect(bare.ok && bare.harness.meta.hash).toBe(harness.meta.hash);
  });

  it('accepts a harness that is only a system prompt', () => {
    expect(validateHarnessFiles({ 'system.md': 'Hello.\n' }).ok).toBe(true);
  });

  it('ignores files that are not part of a harness', () => {
    expect(
      validateHarnessFiles({ ...base(), 'README.md': 'x', 'graduate.yaml': 'name: x' }).ok,
    ).toBe(true);
  });

  it('asks for a system prompt', () => {
    const files = base();
    delete files['system.md'];
    expect(errorsFor(files)).toEqual(['system.md: missing. Every harness needs a system prompt.']);
    expect(errorsFor({ ...base(), 'system.md': ' \n' })).toEqual([
      "system.md: is empty. Write the agent's system prompt.",
    ]);
  });

  it('names the file and the problem for each schema error', () => {
    expect(errorsFor({ ...base(), 'decoding.yaml': 'top_p: 5\n' })).toEqual([
      'decoding.yaml: top_p: Too big: expected number to be <=1',
    ]);
    expect(errorsFor({ ...base(), 'decoding.yaml': 'thinking: extreme\n' })[0]).toMatch(
      /^decoding\.yaml: thinking: /,
    );
    expect(errorsFor({ ...base(), 'retrieval.yaml': 'max_loaded_skills: 40\n' })[0]).toMatch(
      /^retrieval\.yaml: max_loaded_skills: /,
    );
    expect(errorsFor({ ...base(), 'retrieval.yaml': 'rules:\n  - when_any: []\n' })[0]).toMatch(
      /^retrieval\.yaml: rules\[0\]\.when_any: /,
    );
    expect(
      errorsFor({ ...base(), 'guardrails.yaml': 'refuse:\n  - task_type: a\n    when_any: [x]\n' }),
    ).toEqual(['guardrails.yaml: "refuse[0].reason" is required']);
  });

  it('reports YAML and JSON syntax errors with the file name', () => {
    expect(errorsFor({ ...base(), 'retrieval.yaml': 'rules: [\n' })[0]).toMatch(
      /^retrieval\.yaml: not valid YAML \(.+\)$/,
    );
    expect(errorsFor({ ...base(), 'retrieval.yaml': 'a: 1\na: 2\n' })[0]).toMatch(
      /^retrieval\.yaml: not valid YAML \(Map keys must be unique at line 2/,
    );
    expect(errorsFor({ ...base(), 'examples/after-hours-plan-member.json': '{' })[0]).toMatch(
      /^examples\/after-hours-plan-member\.json: not valid JSON/,
    );
    expect(errorsFor({ ...base(), 'decoding.yaml': '- 1\n- 2\n' })).toEqual([
      'decoding.yaml: expected a list of settings such as "name: value"',
    ]);
  });

  it('catches misspelled settings instead of dropping them', () => {
    const [problem] = errorsFor({ ...base(), 'decoding.yaml': 'max_step: 3\n' });
    expect(problem).toBe(
      'decoding.yaml: unknown key "max_step". Allowed keys here: temperature, top_p, top_k, max_steps, max_output_tokens, thinking.',
    );
    expect(errorsFor({ ...base(), 'retrieval.yaml': 'maxLoadedSkills: 3\n' })[0]).toContain(
      'Did you mean "max_loaded_skills"?',
    );
    expect(
      errorsFor({ ...base(), 'retrieval.yaml': 'rules:\n  - when_any: [a]\n    skills: [b]\n' })[0],
    ).toContain('unknown key "rules[0].skills"');
  });

  it('reads and drops a seed left in decoding.yaml by an earlier format', () => {
    expect(
      validateHarnessFiles({ ...base(), 'decoding.yaml': 'seed: 7\ntemperature: 0.3\n' }).ok,
    ).toBe(true);
  });

  it('checks skill front matter', () => {
    expect(errorsFor({ ...base(), 'skills/price-a-job.md': 'No front matter\n' })).toEqual([
      'skills/price-a-job.md: has no front matter. Start the file with a block between "---" lines that sets name and summary.',
    ]);
    expect(
      errorsFor({ ...base(), 'skills/price-a-job.md': '---\nname: Only a name\n---\nbody\n' }),
    ).toEqual(['skills/price-a-job.md: "summary" is required']);
    expect(errorsFor({ ...base(), 'skills/price-a-job.md': '---\n---\nbody\n' })).toEqual([
      'skills/price-a-job.md: "name" is required',
      'skills/price-a-job.md: "summary" is required',
    ]);
    expect(
      errorsFor({
        ...base(),
        'skills/price-a-job.md': '---\nname: A\nsummary: B\ntaskTypes: [x]\n---\n',
      })[0],
    ).toContain('Did you mean "task_types"?');
  });

  it('requires every skill and example named by a retrieval rule to exist', () => {
    const files = base();
    delete files['skills/overdue-balances.md'];
    delete files['examples/after-hours-plan-member.json'];
    expect(errorsFor(files)).toEqual([
      'retrieval.yaml: rule 1 loads example "after-hours-plan-member", but examples/after-hours-plan-member.json does not exist.',
      'retrieval.yaml: rule 2 loads skill "overdue-balances", but skills/overdue-balances.md does not exist.',
    ]);
  });

  describe('tools', () => {
    const manifest = (name: string): string =>
      JSON.stringify({ name, description: 'Does a thing.', parameters: { type: 'object' } });
    const code = 'function run(args, ctx) {\n  return 1;\n}\n';

    it('wants a .js for every .json and a .json for every .js', () => {
      const noCode = base();
      delete noCode['tools/invoice_total.js'];
      expect(errorsFor(noCode)).toEqual([
        'tools/invoice_total.json: has no code. Add tools/invoice_total.js that defines function run(args, ctx).',
      ]);
      const noManifest = base();
      delete noManifest['tools/invoice_total.json'];
      expect(errorsFor(noManifest)).toEqual([
        "tools/invoice_total.js: has no manifest. Add tools/invoice_total.json with the tool's name, description and parameters.",
      ]);
    });

    it('requires the name to match the file, which keeps names unique', () => {
      expect(
        errorsFor({
          ...base(),
          'tools/other.json': manifest('invoice_total'),
          'tools/other.js': code,
        }),
      ).toEqual([
        'tools/other.json: name must match the file name, so it should be "other" (it is "invoice_total").',
      ]);
      expect(
        errorsFor({
          ...base(),
          'tools/other.json': '{"description":"d","parameters":{"type":"object"}}',
          'tools/other.js': code,
        })[0],
      ).toContain('it is null');
    });

    it('refuses the names of built-in tools', () => {
      for (const name of ['read_table', 'list_files', 'calculate', 'load_skill', 'append_rows']) {
        expect(
          errorsFor({
            ...base(),
            [`tools/${name}.json`]: manifest(name),
            [`tools/${name}.js`]: code,
          }),
        ).toEqual([
          `tools/${name}.json: "${name}" is a built-in tool name. Pick a different name.`,
        ]);
      }
    });

    it('wants function run( in the code', () => {
      expect(
        errorsFor({
          ...base(),
          'tools/helper.json': manifest('helper'),
          'tools/helper.js': 'const run = () => 1;\n',
        }),
      ).toEqual([
        'tools/helper.js: does not define function run(args, ctx), which every tool needs.',
      ]);
      expect(
        validateHarnessFiles({
          ...base(),
          'tools/helper.json': manifest('helper'),
          'tools/helper.js': 'async function run (args) { return 1; }\n',
        }).ok,
      ).toBe(true);
    });

    it('checks the manifest fields', () => {
      expect(
        errorsFor({
          ...base(),
          'tools/helper.json': '{"name":"helper","parameters":{"type":"array"}}',
          'tools/helper.js': code,
        }),
      ).toEqual([
        'tools/helper.json: "description" is required',
        'tools/helper.json: parameters.type: Invalid input: expected "object"',
      ]);
    });
  });

  describe('examples', () => {
    it('wants snake_case keys and says which one is meant', () => {
      const example = JSON.stringify({
        title: 'T',
        messages: [{ role: 'assistant', content: 'x', toolCalls: [] }],
      });
      const [problem] = errorsFor({ ...base(), 'examples/after-hours-plan-member.json': example });
      expect(problem).toBe(
        'examples/after-hours-plan-member.json: unknown key "messages[0].toolCalls". Did you mean "tool_calls"? Allowed keys here: role, content, tool_calls.',
      );
    });

    it('wants at least one message and a title', () => {
      expect(
        errorsFor({ ...base(), 'examples/after-hours-plan-member.json': '{"messages":[]}' }),
      ).toEqual([
        'examples/after-hours-plan-member.json: "title" is required',
        'examples/after-hours-plan-member.json: messages: Too small: expected array to have >=1 items',
      ]);
    });

    it('wants the id of the call a tool message answers', () => {
      const example = JSON.stringify({
        title: 'T',
        messages: [{ role: 'tool', name: 'read_table', content: '{}' }],
      });
      expect(errorsFor({ ...base(), 'examples/after-hours-plan-member.json': example })).toEqual([
        'examples/after-hours-plan-member.json: "messages[0].tool_call_id" is required',
      ]);
    });
  });

  it('rejects file names outside the allowed pattern and says what is allowed', () => {
    expect(
      errorsFor({ ...base(), 'skills/Price A Job.md': '---\nname: a\nsummary: b\n---\n' }),
    ).toEqual([
      'skills/Price A Job.md: not a valid file name; skill files are named with lowercase letters, digits and dashes, like skills/price-a-job.md.',
    ]);
    expect(errorsFor({ ...base(), 'tools/helper.py': 'x' })[0]).toMatch(
      /^tools\/helper\.py: not a valid file name; tool files/,
    );
    expect(errorsFor({ ...base(), 'examples/sub/x.json': '{}' })[0]).toMatch(
      /^examples\/sub\/x\.json: not a valid file name/,
    );
    expect(errorsFor({ ...base(), 'skills/con.md': '---\nname: a\nsummary: b\n---\n' })[0]).toMatch(
      /^skills\/con\.md: "con" is a name Windows reserves/,
    );
  });

  it('keeps the whole harness under 256 KB', () => {
    const filler = 'x'.repeat(100 * 1024);
    const files = {
      ...base(),
      'skills/big-one.md': `---\nname: Big\nsummary: Big\n---\n${filler}`,
      'skills/big-two.md': `---\nname: Big\nsummary: Big\n---\n${filler}`,
    };
    expect(validateHarnessFiles(files).ok).toBe(true);
    const over = {
      ...files,
      'skills/big-three.md': `---\nname: Big\nsummary: Big\n---\n${filler}`,
    };
    expect(errorsFor(over)).toEqual([
      expect.stringMatching(/^harness: \d+ KB in total is over the 256 KB limit\./),
    ]);
  });

  it('counts bytes, not characters', () => {
    const files = { 'system.md': 'é'.repeat(129 * 1024) };
    expect(errorsFor(files)[0]).toMatch(/over the 256 KB limit/);
  });

  it('reports every problem at once', () => {
    const errors = errorsFor({
      'system.md': '',
      'decoding.yaml': 'top_p: 5\nmax_step: 3\n',
      'retrieval.yaml': 'rules:\n  - when_any: [a]\n    load_skills: [nope]\n',
      'skills/a.md': 'plain',
      'tools/x.json': '{}',
    });
    expect(errors).toHaveLength(6);
  });

  it('checks harness.yaml when it is given', () => {
    expect(errorsFor({ ...base(), 'harness.yaml': 'format: 2\nname: x\n' })).toEqual([
      'harness.yaml: format 2 is not supported; this version reads format 1',
    ]);
    expect(errorsFor({ ...base(), 'harness.yaml': 'format: 1\n' })).toEqual([
      'harness.yaml: "name" is required',
    ]);
    expect(
      errorsFor({ ...base(), 'harness.yaml': 'format: 1\nname: x\nowner: me\n' })[0],
    ).toContain('unknown key "owner"');
  });
});
