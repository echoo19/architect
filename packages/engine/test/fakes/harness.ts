import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DecodingSchema,
  ExampleSchema,
  GuardError,
  GuardrailsSchema,
  HarnessSchema,
  isHarnessSurfacePath,
  RetrievalSchema,
  type FileDiff,
  type FileEdit,
  type Harness,
  type PackageManifest,
} from '@architect/shared';
import type { HarnessVersionStore } from '../../src/loop/deps';

export function blankHarness(name: string, description: string): Harness {
  return withSystem(name, `You are ${name}. ${description}`);
}

export function templateHarness(name: string, description: string, template: string): Harness {
  return withSystem(name, `You are ${name}. ${description}\nTemplate: ${template}`);
}

function withSystem(name: string, system: string): Harness {
  return {
    meta: { format: 2, name, version: 0, hash: '' },
    system,
    skills: [],
    tools: [],
    examples: [],
    retrieval: RetrievalSchema.parse({}),
    decoding: DecodingSchema.parse({}),
    guardrails: GuardrailsSchema.parse({}),
  };
}

export function harnessToFiles(
  harness: Harness,
  options: { includeDefaults?: boolean } = {},
): Record<string, string> {
  const files: Record<string, string> = { 'AGENTS.md': harness.system };
  for (const skill of harness.skills) files[`skills/${skill.name}/SKILL.md`] = skill.body;
  if (harness.guardrails.refuse.length > 0) {
    files['guardrails.yaml'] = JSON.stringify(harness.guardrails);
  }
  for (const example of harness.examples) {
    files[`examples/${example.slug}.json`] = JSON.stringify(example);
  }
  if (harness.retrieval.rules.length > 0 || options.includeDefaults === true) {
    files['retrieval.yaml'] = JSON.stringify(harness.retrieval);
  }
  return files;
}

function contentHash(harness: Harness): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(harnessToFiles(harness)))
    .digest('hex');
  return `sha256-${digest.slice(0, 16)}`;
}

/** Named like the harness package's error for a change set whose files don't validate. */
class HarnessValidationError extends Error {
  override name = 'HarnessValidationError';
}

/** Enough of the real edit rules for the loop: AGENTS.md, skills, tools and guardrails. */
export function applyEdits(harness: Harness, edits: readonly FileEdit[]): Harness {
  const next = structuredClone(harness);
  for (const edit of edits) {
    if (!isHarnessSurfacePath(edit.path)) {
      throw new GuardError('harness_surface', `${edit.path} is outside the harness surface.`);
    }
    if (edit.path === 'AGENTS.md' && edit.op === 'delete') {
      throw new HarnessValidationError(
        'AGENTS.md: cannot be deleted. Every harness needs its instructions.',
      );
    }
    if (edit.path === 'AGENTS.md' && edit.op === 'write') next.system = edit.content;
    if (edit.path === 'guardrails.yaml') {
      next.guardrails = GuardrailsSchema.parse(edit.op === 'write' ? JSON.parse(edit.content) : {});
    }
    const tool = /^tools\/([a-z][a-z0-9_]*)\.(js|json)$/.exec(edit.path);
    if (tool) {
      const name = tool[1] ?? '';
      const current = next.tools.find((existing) => existing.name === name) ?? {
        name,
        description: name,
        parameters: { type: 'object' as const, properties: {} },
        code: '',
      };
      next.tools = next.tools.filter((existing) => existing.name !== name);
      if (edit.op === 'write') {
        next.tools.push(
          tool[2] === 'js'
            ? { ...current, code: edit.content }
            : { ...current, ...(JSON.parse(edit.content) as object) },
        );
      }
    }
    if (edit.path.startsWith('skills/')) {
      const name = edit.path.slice('skills/'.length, -'/SKILL.md'.length);
      next.skills = next.skills.filter((skill) => skill.name !== name);
      if (edit.op === 'write') next.skills.push({ name, description: name, body: edit.content });
    }
    const example = /^examples\/([a-z0-9-]+)\.json$/.exec(edit.path);
    if (example) {
      const slug = example[1] ?? '';
      next.examples = next.examples.filter((existing) => existing.slug !== slug);
      if (edit.op === 'write') next.examples.push(exampleFromFile(slug, edit.content));
    }
    if (edit.path === 'retrieval.yaml') {
      next.retrieval = RetrievalSchema.parse(edit.op === 'write' ? JSON.parse(edit.content) : {});
    }
  }
  return next;
}

/** An example file as the real harness reads one: snake_case keys, checked message shapes. */
function exampleFromFile(slug: string, content: string): Harness['examples'][number] {
  const file = JSON.parse(content) as {
    title: string;
    task_types?: string[];
    messages: Record<string, unknown>[];
  };
  const messages = file.messages.map((message) => {
    const { tool_calls: toolCalls, tool_call_id: toolCallId, ...rest } = message;
    return {
      ...rest,
      ...(toolCalls === undefined ? {} : { toolCalls }),
      ...(toolCallId === undefined ? {} : { toolCallId }),
    };
  });
  return ExampleSchema.parse({
    slug,
    title: file.title,
    taskTypes: file.task_types ?? [],
    messages,
  });
}

export function diffHarness(from: Harness, to: Harness): FileDiff[] {
  const before = harnessToFiles(from);
  const after = harnessToFiles(to);
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths.flatMap((path): FileDiff[] => {
    if (before[path] === after[path]) return [];
    const status =
      before[path] === undefined ? 'added' : after[path] === undefined ? 'deleted' : 'modified';
    return [{ path, status, patch: `-${before[path] ?? ''}\n+${after[path] ?? ''}` }];
  });
}

/**
 * Harness versions as JSON files, so they outlive one controller like the real folders do.
 * Numbered from 1, as `HarnessVersions` numbers them.
 */
export class FileVersions implements HarnessVersionStore {
  constructor(private readonly dir: string) {}

  async save(harness: Harness, parent?: number): Promise<Harness> {
    const versions = await this.versions();
    const version = versions.length === 0 ? 1 : Math.max(...versions) + 1;
    const saved: Harness = {
      ...harness,
      meta: { ...harness.meta, version, parent, hash: contentHash(harness) },
    };
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `v${version}.json`), JSON.stringify(saved));
    return saved;
  }

  async load(version: number): Promise<Harness> {
    return HarnessSchema.parse(
      JSON.parse(await readFile(join(this.dir, `v${version}.json`), 'utf8')),
    );
  }

  async latest(): Promise<Harness | undefined> {
    const versions = await this.versions();
    return versions.length === 0 ? undefined : this.load(Math.max(...versions));
  }

  async versions(): Promise<number[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    return names
      .filter((name) => /^v\d+\.json$/.test(name))
      .map((name) => Number(name.slice(1, -5)));
  }
}

/**
 * A version's harness read back from the files `harnessToFiles` wrote into its package, the way
 * the real reader does from real files. Tools aren't written by the fake, so none come back.
 */
export async function readPackaged(
  dir: string,
  manifest: Pick<PackageManifest, 'harness' | 'identity'>,
): Promise<Harness> {
  const root = join(dir, 'harness');
  const read = async (path: string): Promise<string | undefined> => {
    try {
      return await readFile(join(root, path), 'utf8');
    } catch {
      return undefined;
    }
  };
  const harness = withSystem(manifest.identity.name, (await read('AGENTS.md')) ?? '');
  for (const name of await folders(join(root, 'skills'))) {
    const body = await read(`skills/${name}/SKILL.md`);
    if (body !== undefined) harness.skills.push({ name, description: name, body });
  }
  for (const file of await folders(join(root, 'examples'))) {
    const content = await read(`examples/${file}`);
    if (content !== undefined) harness.examples.push(ExampleSchema.parse(JSON.parse(content)));
  }
  const guardrails = await read('guardrails.yaml');
  if (guardrails !== undefined) harness.guardrails = GuardrailsSchema.parse(JSON.parse(guardrails));
  const retrieval = await read('retrieval.yaml');
  if (retrieval !== undefined) harness.retrieval = RetrievalSchema.parse(JSON.parse(retrieval));
  return {
    ...harness,
    meta: { ...harness.meta, version: manifest.harness.version, hash: manifest.harness.hash },
  };
}

async function folders(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}
