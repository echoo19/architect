import { basename, resolve } from 'node:path';
import type { Harness } from '@architect/shared';
import {
  DecodingSchema,
  GuardrailsSchema,
  HARNESS_FORMAT,
  RetrievalSchema,
} from '@architect/shared';
import { readHarnessFiles } from './folder';
import { hashHarness } from './hash';
import { META_PATH } from './paths';
import { HarnessValidationError } from './errors';
import { HARNESS_TEMPLATES } from './templates';
import { validateHarnessFiles } from './validate';

function systemFor(name: string, description: string): string {
  const opening = `You are the ${name} agent.\n`;
  const about = description.trim();
  return about === '' ? opening : `${opening}\n${about}\n`;
}

function withSystem(name: string, system: string): Harness {
  const harness: Harness = {
    meta: { format: HARNESS_FORMAT, name, version: 0, hash: '' },
    system,
    skills: [],
    tools: [],
    examples: [],
    retrieval: RetrievalSchema.parse({}),
    decoding: DecodingSchema.parse({}),
    guardrails: GuardrailsSchema.parse({}),
  };
  return { ...harness, meta: { ...harness.meta, hash: hashHarness(harness) } };
}

/** The smallest harness: a system prompt from the job's name and description, and default settings. */
export function blankHarness(name: string, jobDescription: string): Harness {
  return withSystem(name, systemFor(name, jobDescription));
}

/** A harness that starts from a template's general operating rules. Accepts `ops-analyst` or `templates/ops-analyst`. */
export function templateHarness(name: string, jobDescription: string, template: string): Harness {
  const id = template.replace(/^templates\//, '');
  const found = HARNESS_TEMPLATES.find((candidate) => candidate.id === id);
  if (!found) {
    const available = HARNESS_TEMPLATES.map((candidate) => candidate.id).join(', ');
    throw new HarnessValidationError([`Unknown template "${template}". Available: ${available}.`]);
  }
  return withSystem(name, `${systemFor(name, jobDescription)}\n${found.guidance}`);
}

/**
 * Reads a folder to improve, as a new starting point: version 0 with no parent and a fresh hash.
 * The folder must validate. A folder without harness.yaml is accepted and named after itself.
 */
export async function importHarness(dir: string): Promise<Harness> {
  const files = await readHarnessFiles(dir);
  const result = validateHarnessFiles(files);
  if (!result.ok) throw new HarnessValidationError(result.errors);
  const { harness } = result;
  const name = files[META_PATH] === undefined ? basename(resolve(dir)) : harness.meta.name;
  const fresh: Harness = {
    ...harness,
    meta: { format: HARNESS_FORMAT, name, version: 0, hash: '' },
  };
  return { ...fresh, meta: { ...fresh.meta, hash: hashHarness(fresh) } };
}
