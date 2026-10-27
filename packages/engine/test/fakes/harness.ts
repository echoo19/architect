import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DecodingSchema,
  GuardError,
  GuardrailsSchema,
  HarnessSchema,
  isHarnessSurfacePath,
  RetrievalSchema,
  type FileDiff,
  type FileEdit,
  type Harness,
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
    meta: { format: 1, name, version: 0, hash: '' },
    system,
    skills: [],
    tools: [],
    examples: [],
    retrieval: RetrievalSchema.parse({}),
    decoding: DecodingSchema.parse({}),
    guardrails: GuardrailsSchema.parse({}),
  };
}

export function harnessToFiles(harness: Harness): Record<string, string> {
  const files: Record<string, string> = { 'system.md': harness.system };
  for (const skill of harness.skills) files[`skills/${skill.slug}.md`] = skill.body;
  if (harness.guardrails.refuse.length > 0) {
    files['guardrails.yaml'] = JSON.stringify(harness.guardrails);
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

/** Enough of the real edit rules for the loop: system.md, skills, tools and guardrails. */
export function applyEdits(harness: Harness, edits: readonly FileEdit[]): Harness {
  const next = structuredClone(harness);
  for (const edit of edits) {
    if (!isHarnessSurfacePath(edit.path)) {
      throw new GuardError('harness_surface', `${edit.path} is outside the harness surface.`);
    }
    if (edit.path === 'system.md' && edit.op === 'delete') {
      throw new HarnessValidationError(
        'system.md: cannot be deleted. Every harness needs a system prompt.',
      );
    }
    if (edit.path === 'system.md' && edit.op === 'write') next.system = edit.content;
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
      const slug = edit.path.slice('skills/'.length, -'.md'.length);
      next.skills = next.skills.filter((skill) => skill.slug !== slug);
      if (edit.op === 'write') {
        next.skills.push({ slug, name: slug, summary: slug, taskTypes: [], body: edit.content });
      }
    }
  }
  return next;
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
