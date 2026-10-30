import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelConfigSchema, type ModelConfig } from '@architect/shared';
import type { HubClient } from '../hub';
import { SizingError } from './size';

/** A config.json is a few kilobytes; anything near this is not one. */
const MAX_CONFIG_BYTES = 1024 * 1024;

/** Parses a config.json's text, refusing what isn't a JSON object. */
export function parseModelConfig(text: string, where: string): ModelConfig {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SizingError(`${where} isn't JSON.`);
  }
  const parsed = ModelConfigSchema.safeParse(value);
  if (!parsed.success) throw new SizingError(`${where} isn't a JSON object.`);
  return parsed.data;
}

/**
 * Reads a model's `config.json` from the Hub at a revision, which is resolved to its commit
 * first so the plan and any bundle name exactly what was sized. Setup only: a graduate never
 * calls this.
 */
export async function fetchModelConfig(
  hub: HubClient,
  repo: string,
  ref: string,
  signal?: AbortSignal,
): Promise<{ config: ModelConfig; revision: string }> {
  const revision = await hub.revision(repo, ref, signal);
  const dir = mkdtempSync(join(tmpdir(), 'architect-config-'));
  try {
    const dest = join(dir, 'config.json');
    await hub.download(repo, revision, 'config.json', dest, null, signal, {
      maxBytes: MAX_CONFIG_BYTES,
    });
    return {
      config: parseModelConfig(readFileSync(dest, 'utf8'), `${repo}'s config.json`),
      revision,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
