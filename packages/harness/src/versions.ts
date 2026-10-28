import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Harness, HarnessMeta } from '@architect/shared';
import { HarnessValidationError } from './errors';
import { hashHarness } from './hash';
import { readHarness, readStoredHarness, writeHarness } from './folder';
import { parseMeta } from './parse';
import { META_PATH } from './paths';

const VERSION_DIR = /^v(\d{4,})$/;

const versionDirName = (version: number): string => `v${String(version).padStart(4, '0')}`;

/**
 * Every version of a run's harness, one folder each (`v0001`, `v0002`, ...) under `dir`.
 * A version is never rewritten: `save` always takes the next number, and a folder is only
 * counted once its `harness.yaml`, written last, is in place. Reverted versions stay on disk.
 */
export class HarnessVersions {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Where the folder for a version lives (it may not exist). */
  pathOf(version: number): string {
    return join(this.dir, versionDirName(version));
  }

  /**
   * Saves a harness as the next version and returns it with `meta.version`, `meta.parent` and
   * `meta.hash` filled in. `parent` is the version it was derived from; leave it out for the first.
   */
  async save(harness: Harness, parent?: number): Promise<Harness> {
    const taken = await this.versionNumbers();
    if (parent !== undefined && !taken.includes(parent)) {
      throw new HarnessValidationError([
        `Version ${parent} does not exist, so it cannot be a parent.`,
      ]);
    }
    const version = (taken.at(-1) ?? 0) + 1;
    const meta: HarnessMeta = {
      format: harness.meta.format,
      name: harness.meta.name,
      version,
      ...(parent === undefined ? {} : { parent }),
      hash: hashHarness(harness),
    };

    await mkdir(this.dir, { recursive: true });
    const target = this.pathOf(version);
    await mkdir(target);
    try {
      await writeHarness(target, { ...harness, meta });
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
    return readHarness(target);
  }

  /**
   * Reads a version back, checking that its files still match the hash recorded when it was
   * saved. A version saved in format 1 comes back in the current format, with a new hash.
   */
  async load(version: number): Promise<Harness> {
    const dir = this.pathOf(version);
    if (!(await this.isComplete(version))) {
      throw new HarnessValidationError([
        `Harness version ${version} does not exist in ${this.dir}.`,
      ]);
    }
    const stored = await readStoredHarness(dir);
    if (stored.filesHash !== stored.recordedHash) {
      throw new HarnessValidationError([
        `${versionDirName(version)}: files changed after the version was saved. Saved versions are never edited.`,
      ]);
    }
    return stored.harness;
  }

  /** The newest version, or undefined when none has been saved yet. */
  async latest(): Promise<Harness | undefined> {
    const newest = (await this.list()).at(-1);
    return newest ? this.load(newest.version) : undefined;
  }

  /** The meta of every saved version as harness.yaml records it, oldest first. */
  async list(): Promise<HarnessMeta[]> {
    const metas: HarnessMeta[] = [];
    for (const version of await this.versionNumbers()) {
      if (!(await this.isComplete(version))) continue;
      const text = await readFile(join(this.pathOf(version), META_PATH), 'utf8');
      const problems: string[] = [];
      const parsed = parseMeta(text, problems);
      if (!parsed)
        throw new HarnessValidationError(problems.map((p) => `${versionDirName(version)}/${p}`));
      metas.push(parsed.meta);
    }
    return metas;
  }

  private async versionNumbers(): Promise<number[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const match = VERSION_DIR.exec(entry.name);
        return match?.[1] ? [Number(match[1])] : [];
      })
      .sort((a, b) => a - b);
  }

  private async isComplete(version: number): Promise<boolean> {
    const info = await stat(join(this.pathOf(version), META_PATH)).catch(() => undefined);
    return info?.isFile() ?? false;
  }
}
