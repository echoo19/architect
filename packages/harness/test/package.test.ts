import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PackageError, type PackageProblemCode } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  extractZip,
  PACKAGE_LIMITS,
  readPackage,
  readZipEntries,
  scanText,
  sha256Bytes,
  writePackage,
  writeZip,
} from '../src';
import { cleanTempDirsAfterEach, tempDir } from './fixtures';
import { craftZip, sampleDraft } from './package-fixtures';

cleanTempDirsAfterEach();

async function refusal(promise: Promise<unknown>): Promise<PackageError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PackageError);
    return error as PackageError;
  }
  throw new Error('expected a PackageError');
}

async function expectCode(promise: Promise<unknown>, code: PackageProblemCode): Promise<string> {
  const error = await refusal(promise);
  expect(error.code, error.message).toBe(code);
  return error.message;
}

async function samplePackage(): Promise<string> {
  const dir = join(await tempDir(), 'service-desk');
  await writePackage(dir, sampleDraft(), [
    { path: 'harness/system.md', content: 'You are the service desk.\n' },
    { path: 'harness/harness.yaml', content: 'format: 1\nname: Service desk\n' },
    { path: 'evidence/report.md', content: '# Report\n' },
  ]);
  return dir;
}

describe('package folders', () => {
  it('write every file, then a manifest that lists each with its checksum', async () => {
    const dir = await samplePackage();
    const read = await readPackage(dir);
    expect(read.manifest.identity).toMatchObject({ agentId: 'grd_sample', version: 1 });
    expect(read.manifest.integrity.files.map((file) => file.path)).toEqual([
      'evidence/report.md',
      'harness/harness.yaml',
      'harness/system.md',
    ]);
    expect(read.digest).toMatch(/^[0-9a-f]{64}$/);
    const text = await readFile(join(dir, 'graduate.json'), 'utf8');
    expect(text).toContain('"agent_id": "grd_sample"');
    expect(text).not.toContain('agentId');
    expect((await readPackage(dir)).digest).toBe(read.digest);
  });

  it('never write over a version or outside the package', async () => {
    const dir = await samplePackage();
    await expect(writePackage(dir, sampleDraft(), [])).rejects.toThrow('never written over');
    const other = join(await tempDir(), 'other');
    await expectCode(
      writePackage(other, sampleDraft(), [{ path: '../escape.txt', content: 'x' }]),
      'unsafe_path',
    );
    await expectCode(
      writePackage(other, sampleDraft(), [{ path: 'graduate.json', content: '{}' }]),
      'unsafe_path',
    );
  });

  it('refuse a file changed, removed or added after packaging', async () => {
    const changed = await samplePackage();
    await writeFile(join(changed, 'harness', 'system.md'), 'You are someone else.\n');
    await expectCode(readPackage(changed), 'checksum');

    const removed = await samplePackage();
    await writeFile(join(removed, 'evidence', 'report.md'), '');
    await expectCode(readPackage(removed), 'checksum');

    const added = await samplePackage();
    await writeFile(join(added, 'harness', 'extra.md'), 'not listed\n');
    expect(await expectCode(readPackage(added), 'unlisted_file')).toContain('harness/extra.md');
  });

  it('refuse a manifest from a newer Architect, or one with fields it does not know', async () => {
    const newer = await samplePackage();
    const manifest = JSON.parse(await readFile(join(newer, 'graduate.json'), 'utf8'));
    await writeFile(join(newer, 'graduate.json'), JSON.stringify({ ...manifest, schema: 3 }));
    expect(await expectCode(readPackage(newer), 'unknown_schema')).toContain('newer Architect');

    const unknown = await samplePackage();
    await writeFile(
      join(unknown, 'graduate.json'),
      JSON.stringify({ ...manifest, base_url: 'http://127.0.0.1:11434' }),
    );
    await expectCode(readPackage(unknown), 'invalid_manifest');
  });

  it('hold an adapter to the very file their integrity section lists', async () => {
    const weights = 'LORA WEIGHTS';
    const adapter = {
      path: 'adapter/adapter.gguf',
      format: 'gguf_lora' as const,
      sha256: sha256Bytes(weights),
      sizeBytes: weights.length,
      baseDigest: `sha256:${'a1'.repeat(32)}`,
      scale: 1,
      trainingJobId: 'trn_glimmer1',
    };
    const { model } = sampleDraft();
    const files = [
      { path: 'harness/system.md', content: 'You are the service desk.\n' },
      { path: adapter.path, content: weights },
    ];
    const dir = join(await tempDir(), 'with-adapter');
    await writePackage(dir, sampleDraft({ model: { ...model, adapter } }), files);
    expect((await readPackage(dir)).manifest.model.adapter).toEqual(adapter);

    const other = { ...adapter, sha256: sha256Bytes('OTHER WEIGHTS') };
    await expectCode(
      writePackage(
        join(await tempDir(), 'other'),
        sampleDraft({ model: { ...model, adapter: other } }),
        files,
      ),
      'invalid_manifest',
    );
    // Every file still matches its integrity entry; only the adapter's own record disagrees.
    const manifest = JSON.parse(await readFile(join(dir, 'graduate.json'), 'utf8'));
    manifest.model.adapter.sha256 = other.sha256;
    await writeFile(join(dir, 'graduate.json'), JSON.stringify(manifest));
    expect(await expectCode(readPackage(dir), 'invalid_manifest')).toContain('model.adapter');
  });

  it('refuse links inside a package folder', async () => {
    const dir = await samplePackage();
    const outside = await tempDir();
    try {
      await symlink(outside, join(dir, 'harness', 'linked'), 'junction');
    } catch {
      return; // This system won't make links for an unprivileged user; nothing to check.
    }
    await expectCode(readPackage(dir), 'link');
  });

  it('pass over what file managers leave in a folder', async () => {
    const dir = await samplePackage();
    const before = await readPackage(dir);
    await writeFile(join(dir, '.DS_Store'), 'finder');
    await writeFile(join(dir, 'harness', 'Thumbs.db'), 'explorer');
    await writeFile(join(dir, 'harness', 'desktop.ini'), '[.ShellClassInfo]');
    await writeFile(join(dir, 'harness', '._system.md'), 'appledouble');
    await mkdir(join(dir, '__MACOSX'));
    await writeFile(join(dir, '__MACOSX', 'harness'), 'resource fork');
    const after = await readPackage(dir);
    expect(after.digest).toBe(before.digest);
    expect(after.files).toEqual(before.files);
  });
});

describe('package archives', () => {
  async function zipped(): Promise<{ dir: string; archive: string }> {
    const dir = await samplePackage();
    const archive = join(await tempDir(), 'service-desk.architect.zip');
    const paths = ['graduate.json', ...(await readPackage(dir)).files.map((file) => file.path)];
    await writeZip(archive, dir, paths);
    return { dir, archive };
  }

  it('round-trip byte for byte, and the same files always make the same archive', async () => {
    const { dir, archive } = await zipped();
    const out = join(await tempDir(), 'out');
    await extractZip(archive, await readZipEntries(archive), out);
    const original = await readPackage(dir);
    const extracted = await readPackage(out);
    expect(extracted.digest).toBe(original.digest);
    expect(await readdir(out)).toEqual(['evidence', 'graduate.json', 'harness']);

    const again = join(await tempDir(), 'again.architect.zip');
    await writeZip(again, dir, ['graduate.json', ...original.files.map((file) => file.path)]);
    expect(await readFile(again)).toEqual(await readFile(archive));
    await expect(writeZip(archive, dir, [])).rejects.toThrow('already exists');
  });

  async function crafted(entries: Parameters<typeof craftZip>[1]): Promise<string> {
    const file = join(await tempDir(), 'crafted.zip');
    await craftZip(file, entries);
    return file;
  }

  const text = (value: string) => Buffer.from(value, 'utf8');

  it('refuse entries that climb out, are absolute, or name one file twice', async () => {
    for (const name of ['../evil.txt', 'harness/../../evil.txt', '/etc/passwd', 'C:/evil.txt']) {
      const message = await expectCode(
        readZipEntries(await crafted([{ name, data: text('x') }])),
        'unsafe_path',
      );
      expect(message).toContain(name);
    }
    await expectCode(
      readZipEntries(await crafted([{ name: 'harness\\evil.txt', data: text('x') }])),
      'unsafe_path',
    );
    await expectCode(
      readZipEntries(
        await crafted([
          { name: 'Harness/system.md', data: text('a') },
          { name: 'harness/SYSTEM.md', data: text('b') },
        ]),
      ),
      'unsafe_path',
    );
  });

  it('refuse links and special files, whichever system made the archive', async () => {
    await expectCode(
      readZipEntries(
        await crafted([
          { name: 'harness/link', data: text('/etc'), externalAttributes: (0o120777 << 16) >>> 0 },
        ]),
      ),
      'link',
    );
    await expectCode(
      readZipEntries(
        await crafted([{ name: 'harness/pipe', externalAttributes: (0o010644 << 16) >>> 0 }]),
      ),
      'link',
    );
    await expectCode(
      readZipEntries(
        await crafted([
          { name: 'harness/junction', madeBy: 20, externalAttributes: 0x400, data: text('x') },
        ]),
      ),
      'link',
    );
  });

  it('refuse entries that are too large, too many, or expand like a bomb', async () => {
    const limits = { ...PACKAGE_LIMITS, maxFileBytes: 1024, maxTotalBytes: 4096, maxFiles: 3 };
    await expectCode(
      readZipEntries(await crafted([{ name: 'big.bin', data: Buffer.alloc(2048) }]), limits),
      'too_large',
    );
    await expectCode(
      readZipEntries(
        await crafted(
          ['a', 'b', 'c', 'd'].map((name) => ({ name: `${name}.txt`, data: text(name) })),
        ),
        limits,
      ),
      'too_many_files',
    );
    await expectCode(
      readZipEntries(
        await crafted([{ name: 'zeros.bin', data: Buffer.alloc(8 * 1024 ** 2), method: 8 }]),
      ),
      'too_large',
    );
  });

  it('stop unpacking an entry that holds more than it declares', async () => {
    const archive = await crafted([
      { name: 'lies.txt', data: Buffer.alloc(4096, 97), method: 8, declaredSize: 16 },
    ]);
    const entries = await readZipEntries(archive);
    const out = join(await tempDir(), 'out');
    await expectCode(extractZip(archive, entries, out), 'too_large');
  });

  it('refuse encryption, unknown compression and damaged archives', async () => {
    await expectCode(
      readZipEntries(await crafted([{ name: 'secret.txt', data: text('x'), flags: 1 }])),
      'archive',
    );
    await expectCode(
      readZipEntries(await crafted([{ name: 'odd.txt', data: text('x'), method: 12 }])),
      'archive',
    );
    const notZip = join(await tempDir(), 'not.zip');
    await writeFile(notZip, 'just text, not an archive at all');
    await expectCode(readZipEntries(notZip), 'archive');

    const whole = await readFile(await crafted([{ name: 'a.txt', data: text('hello') }]));
    const cut = join(await tempDir(), 'cut.zip');
    await writeFile(cut, Buffer.concat([whole.subarray(0, 10), whole.subarray(whole.length - 22)]));
    await expectCode(readZipEntries(cut), 'archive');
  });

  it('refuse a directory larger than its entries could need, before reading it', async () => {
    const whole = await readFile(await crafted([{ name: 'a.txt', data: text('hello') }]));
    const padding = Buffer.alloc(64 * 1024);
    const end = Buffer.from(whole.subarray(whole.length - 22));
    const directoryAt = end.readUInt32LE(16);
    end.writeUInt32LE(whole.length - 22 - directoryAt + padding.length, 12);
    const bloated = join(await tempDir(), 'bloated.zip');
    await writeFile(bloated, Buffer.concat([whole.subarray(0, whole.length - 22), padding, end]));
    expect(await expectCode(readZipEntries(bloated), 'archive')).toContain(
      'larger than its 1 entry needs',
    );
  });

  it('leave out what file managers add to archives', async () => {
    const archive = await crafted([
      { name: '__MACOSX/._graduate.json', data: text('resource fork') },
      { name: 'harness/.DS_Store', data: text('finder') },
      { name: 'harness/system.md', data: text('You are the desk.\n') },
    ]);
    expect((await readZipEntries(archive)).map((entry) => entry.path)).toEqual([
      'harness/system.md',
    ]);
  });

  it('extract folders made from file paths and nothing else', async () => {
    const archive = await crafted([
      { name: 'harness/', externalAttributes: (0o040755 << 16) >>> 0 },
      { name: 'harness/system.md', data: text('You are the desk.\n'), method: 8 },
    ]);
    const entries = await readZipEntries(archive);
    expect(entries.map((entry) => entry.path)).toEqual(['harness/system.md']);
    const out = join(await tempDir(), 'out');
    await mkdir(out);
    await extractZip(archive, entries, out);
    expect(await readFile(join(out, 'harness', 'system.md'), 'utf8')).toBe('You are the desk.\n');
  });
});

describe('the export scan', () => {
  const options = {
    storedKeys: ['mk-live-7f3a9c2b11d04e55'],
    privateFolders: ['C:\\Users\\dana\\AppData\\Roaming\\Architect'],
  };

  it('finds stored keys, key shapes and private paths without repeating them', () => {
    const findings = scanText(
      'harness/skills/notes.md',
      [
        'Use the key mk-live-7f3a9c2b11d04e55 for the API.',
        'token = "abcdefghijklmnop1234"',
        'Files are in C:\\Users\\dana\\Documents\\exports.',
        'Saved under c:/users/dana/appdata/roaming/architect/jobs.',
        'Read data/invoices.csv and answer.',
      ].join('\n'),
      options,
    );
    expect(findings.map(({ line, kind }) => [line, kind])).toEqual([
      [1, 'stored_key'],
      [2, 'key_shape'],
      [3, 'private_path'],
      [4, 'private_path'],
    ]);
    for (const finding of findings) {
      expect(finding.excerpt).toContain('[redacted]');
      expect(finding.excerpt).not.toContain('mk-live-7f3a9c2b11d04e55');
      expect(finding.excerpt).not.toContain('dana');
    }
  });

  it('leaves ordinary text alone', () => {
    expect(
      scanText('harness/system.md', 'You price jobs from data/jobs.csv in cents.\n', options),
    ).toEqual([]);
  });

  it('masks everything found on a line in each excerpt, whatever its kind', () => {
    const findings = scanText(
      'harness/system.md',
      'Use mk-live-7f3a9c2b11d04e55 with files in C:/Users/dana/Documents',
      options,
    );
    expect(findings.map((finding) => finding.kind)).toEqual(['stored_key', 'private_path']);
    for (const finding of findings) {
      expect(finding.excerpt).toBe('Use [redacted] with files in [redacted]/Documents');
    }
  });

  it('finds paths as JSON writes them, with doubled backslashes', () => {
    const json = JSON.stringify({
      file: 'C:\\Users\\dana\\invoices.csv',
      share: '\\\\nas\\finance',
    });
    const findings = scanText('evidence/report.json', json, { storedKeys: [], privateFolders: [] });
    expect(findings).toMatchObject([{ kind: 'private_path' }]);
    expect(findings[0]?.excerpt).not.toContain('dana');
    expect(findings[0]?.excerpt).not.toContain('nas');
  });

  it('stays fast on lines built to make a pattern backtrack', () => {
    const line = `token${' '.repeat(200_000)}x`;
    const started = performance.now();
    expect(scanText('harness/system.md', line, options)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
