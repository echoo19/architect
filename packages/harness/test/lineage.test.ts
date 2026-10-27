import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendLineage, HarnessValidationError, readLineage } from '../src';
import { cleanTempDirsAfterEach, sampleLineage, tempDir } from './fixtures';

cleanTempDirsAfterEach();

describe('lineage.jsonl', () => {
  it('reads as empty before the first entry', async () => {
    const dir = await tempDir();
    expect(await readLineage(join(dir, 'lineage.jsonl'))).toEqual([]);
  });

  it('appends one line per entry and reads them back in order', async () => {
    const dir = await tempDir();
    const path = join(dir, 'runs', 'one', 'lineage.jsonl');
    const [first, second] = sampleLineage();
    if (!first || !second) throw new Error('fixture has two entries');
    await appendLineage(path, first);
    await appendLineage(path, second);
    expect(await readLineage(path)).toEqual([first, second]);
    expect((await readFile(path, 'utf8')).split('\n')).toHaveLength(3);
  });

  it('keeps the null cost of a mentor call that was not priced', async () => {
    const dir = await tempDir();
    const path = join(dir, 'lineage.jsonl');
    const unpriced = sampleLineage()[1];
    if (!unpriced) throw new Error('fixture has two entries');
    await appendLineage(path, unpriced);
    expect((await readLineage(path))[0]?.mentor.costUsd).toBeNull();
  });

  it('refuses to append an entry that does not match the schema, and writes nothing', async () => {
    const dir = await tempDir();
    const path = join(dir, 'lineage.jsonl');
    const [entry] = sampleLineage();
    if (!entry) throw new Error('fixture has an entry');
    await expect(appendLineage(path, { ...entry, round: 0 })).rejects.toBeInstanceOf(
      HarnessValidationError,
    );
    expect(await readLineage(path)).toEqual([]);
  });

  it('names the line and the problem for every bad line', async () => {
    const dir = await tempDir();
    const path = join(dir, 'lineage.jsonl');
    const [entry] = sampleLineage();
    if (!entry) throw new Error('fixture has an entry');
    await appendLineage(path, entry);
    const good = (await readFile(path, 'utf8')).trim();
    await writeFile(
      path,
      [good, '{not json', '', JSON.stringify({ id: 'x' }), good, '[1]'].join('\n'),
    );
    try {
      await readLineage(path);
      expect.unreachable();
    } catch (error) {
      const errors = (error as HarnessValidationError).errors;
      expect(errors[0]).toMatch(/^lineage\.jsonl line 2: not valid JSON/);
      expect(
        errors.some((message) => message.startsWith('lineage.jsonl line 4: "run_id" is required')),
      ).toBe(true);
      expect(errors.some((message) => message.startsWith('lineage.jsonl line 6: '))).toBe(true);
      expect(errors.some((message) => message.startsWith('lineage.jsonl line 1'))).toBe(false);
      expect(errors.some((message) => message.startsWith('lineage.jsonl line 5'))).toBe(false);
    }
  });
});
