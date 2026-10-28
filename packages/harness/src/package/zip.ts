import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw, createInflateRaw } from 'node:zlib';
import { PackageError, packagePathProblem } from '@architect/shared';
import { isOsNoise, PACKAGE_LIMITS, sameFileKey, type PackageLimits } from './files';

/*
 * The ZIP subset packages use (PKWARE APPNOTE 6.3): stored or deflated entries, UTF-8 names, no
 * encryption, no ZIP64, no spanning. Reading is strict on purpose: an archive comes from someone
 * else, so every name, size, offset and type is checked before a byte is extracted.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const UTF8_FLAG = 1 << 11;
const ENCRYPTED_FLAG = 1;
const STRONG_ENCRYPTION_FLAG = 1 << 6;
const STORE = 0;
const DEFLATE = 8;
/** "Made by" Unix, ZIP 2.0, so readers take the high half of the external attributes as a mode. */
const MADE_BY_UNIX = (3 << 8) | 20;
const VERSION_NEEDED = 20;
/** 1980-01-01 00:00, the earliest DOS date: archives of the same files are byte for byte equal. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
const REGULAR_FILE_MODE = 0o100644;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const DOS_DIRECTORY = 0x10;
const DOS_REPARSE_POINT = 0x400;
const MAX_UINT32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;
/** Files that are already compressed or are model weights gain nothing from deflate. */
const STORED_EXTENSIONS = /\.(gguf|safetensors|bin|zip|png|jpe?g|gz)$/i;
/** A small file may compress very well; past this size a huge ratio means a decompression bomb. */
const RATIO_FLOOR_BYTES = 1024 ** 2;
const MAX_RATIO = 200;
/**
 * The most a directory record of a package entry can need: the header, a name of 240 characters
 * in UTF-8, and room for the extra fields other tools add. The directory is read only when it
 * fits that many records, so an end record can't make the reader allocate gigabytes.
 */
const MAX_DIRECTORY_RECORD_BYTES = CENTRAL_HEADER_BYTES + 960 + 2048;

interface CentralRecord {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

/**
 * Writes the files at `paths` under `root` into a new ZIP at `target`, in that order, with fixed
 * timestamps. The archive is written beside `target` and renamed into place; `target` must not
 * exist.
 */
export async function writeZip(
  target: string,
  root: string,
  paths: readonly string[],
): Promise<void> {
  if (paths.length > MAX_ENTRIES) throw new Error('A package archive holds at most 65,535 files.');
  if (await stat(target).catch(() => null)) throw new Error(`${target} already exists.`);
  const partial = `${target}.${randomUUID()}.partial`;
  const handle = await open(partial, 'wx');
  try {
    const records: CentralRecord[] = [];
    let position = 0;
    for (const path of paths) {
      const problem = packagePathProblem(path);
      if (problem !== null) throw new Error(`"${path}" ${problem}.`);
      const name = Buffer.from(path, 'utf8');
      const method = STORED_EXTENSIONS.test(path) ? STORE : DEFLATE;
      const offset = position;
      position += LOCAL_HEADER_BYTES + name.length;
      const data = await writeEntryData(handle, join(root, ...path.split('/')), method, position);
      position += data.compressedSize;
      if (position > MAX_UINT32) throw new Error('A package archive is limited to 4 GB.');
      const record: CentralRecord = { name, method, offset, ...data };
      await handle.write(localHeader(record), 0, LOCAL_HEADER_BYTES + name.length, offset);
      records.push(record);
    }
    const central = Buffer.concat(records.map(centralHeader));
    await handle.write(central, 0, central.length, position);
    const end = Buffer.alloc(END_BYTES);
    end.writeUInt32LE(END_OF_CENTRAL, 0);
    end.writeUInt16LE(records.length, 8);
    end.writeUInt16LE(records.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(position, 16);
    await handle.write(end, 0, END_BYTES, position + central.length);
    await handle.close();
    await rename(partial, target);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(partial, { force: true });
    throw error;
  }
}

async function writeEntryData(
  handle: FileHandle,
  file: string,
  method: number,
  start: number,
): Promise<{ crc: number; compressedSize: number; size: number }> {
  let crc = 0;
  let size = 0;
  let compressedSize = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      callback(null, chunk);
    },
  });
  const sink = createWriteStream('', { fd: handle.fd, start, autoClose: false });
  const count = new Transform({
    transform(chunk: Buffer, _encoding, callback: TransformCallback) {
      compressedSize += chunk.length;
      callback(null, chunk);
    },
  });
  if (method === DEFLATE) {
    await pipeline(createReadStream(file), measure, createDeflateRaw({ level: 9 }), count, sink);
  } else {
    await pipeline(createReadStream(file), measure, count, sink);
  }
  if (size > MAX_UINT32) throw new Error(`${file} is over the 4 GB a package file may hold.`);
  return { crc, compressedSize, size };
}

function localHeader(record: CentralRecord): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES + record.name.length);
  header.writeUInt32LE(LOCAL_HEADER, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(record.method, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(record.crc >>> 0, 14);
  header.writeUInt32LE(record.compressedSize, 18);
  header.writeUInt32LE(record.size, 22);
  header.writeUInt16LE(record.name.length, 26);
  header.writeUInt16LE(0, 28);
  record.name.copy(header, LOCAL_HEADER_BYTES);
  return header;
}

function centralHeader(record: CentralRecord): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER_BYTES + record.name.length);
  header.writeUInt32LE(CENTRAL_HEADER, 0);
  header.writeUInt16LE(MADE_BY_UNIX, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(record.method, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(record.crc >>> 0, 16);
  header.writeUInt32LE(record.compressedSize, 20);
  header.writeUInt32LE(record.size, 24);
  header.writeUInt16LE(record.name.length, 28);
  header.writeUInt32LE((REGULAR_FILE_MODE << 16) >>> 0, 38);
  header.writeUInt32LE(record.offset, 42);
  record.name.copy(header, CENTRAL_HEADER_BYTES);
  return header;
}

/** A checked archive entry: a file to extract, never a link, a device or a folder. */
export interface ZipEntry {
  path: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  /** Where its data starts in the archive. */
  dataStart: number;
}

const refuse = (code: ConstructorParameters<typeof PackageError>[0], problem: string): never => {
  throw new PackageError(code, [problem]);
};

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length)
    refuse('archive', 'The archive ends early; it is cut short or damaged.');
  return buffer;
}

/**
 * Reads an archive's directory and checks every entry before anything is extracted: plain UTF-8
 * names that are portable package paths, no two names for one file, no links or special files,
 * no encryption or unknown compression, sizes within the limits, and data that lies where the
 * directory says without overlapping another entry. Folder entries are dropped; folders are
 * made from the file paths. Throws a PackageError.
 */
export async function readZipEntries(
  archive: string,
  limits: PackageLimits = PACKAGE_LIMITS,
): Promise<ZipEntry[]> {
  const handle = await open(archive, 'r');
  try {
    const { size: archiveSize } = await handle.stat();
    if (archiveSize > limits.maxTotalBytes) {
      refuse('too_large', 'The archive is larger than a package may be.');
    }
    if (archiveSize < END_BYTES) refuse('archive', "This file isn't a ZIP archive.");
    const tailLength = Math.min(archiveSize, END_BYTES + MAX_COMMENT_BYTES);
    const tail = await readAt(handle, archiveSize - tailLength, tailLength);
    let endAt = -1;
    for (let at = tail.length - END_BYTES; at >= 0; at -= 1) {
      if (tail.readUInt32LE(at) !== END_OF_CENTRAL) continue;
      if (at + END_BYTES + tail.readUInt16LE(at + 20) === tail.length) {
        endAt = at;
        break;
      }
    }
    if (endAt < 0) refuse('archive', "This file isn't a ZIP archive.");
    if (endAt >= 20 && tail.readUInt32LE(endAt - 20) === ZIP64_LOCATOR) {
      refuse('too_large', 'The archive uses ZIP64, which a package never needs.');
    }
    const disk = tail.readUInt16LE(endAt + 4);
    const centralDisk = tail.readUInt16LE(endAt + 6);
    const onDisk = tail.readUInt16LE(endAt + 8);
    const count = tail.readUInt16LE(endAt + 10);
    const centralSize = tail.readUInt32LE(endAt + 12);
    const centralOffset = tail.readUInt32LE(endAt + 16);
    const endOffset = archiveSize - tailLength + endAt;
    if (disk !== 0 || centralDisk !== 0 || onDisk !== count) {
      refuse('archive', 'The archive spans several files, which a package never does.');
    }
    if (count === MAX_ENTRIES || centralSize === MAX_UINT32 || centralOffset === MAX_UINT32) {
      refuse('too_large', 'The archive uses ZIP64, which a package never needs.');
    }
    if (count > limits.maxFiles) {
      refuse(
        'too_many_files',
        `The archive has ${count} entries; a package has at most ${limits.maxFiles}.`,
      );
    }
    if (centralOffset + centralSize !== endOffset) {
      refuse('archive', "The archive's directory isn't where its end record says.");
    }
    if (centralSize > count * MAX_DIRECTORY_RECORD_BYTES) {
      refuse(
        'archive',
        `The archive's directory is larger than its ${count} ${count === 1 ? 'entry needs' : 'entries need'}.`,
      );
    }
    const central = await readAt(handle, centralOffset, centralSize);

    const entries: ZipEntry[] = [];
    const names = new Map<string, string>();
    const folders = new Set<string>();
    let total = 0;
    let at = 0;
    for (let index = 0; index < count; index += 1) {
      if (
        at + CENTRAL_HEADER_BYTES > central.length ||
        central.readUInt32LE(at) !== CENTRAL_HEADER
      ) {
        refuse('archive', "The archive's directory is damaged.");
      }
      const madeBy = central.readUInt16LE(at + 4);
      const flags = central.readUInt16LE(at + 8);
      const method = central.readUInt16LE(at + 10);
      const crc = central.readUInt32LE(at + 16);
      const compressedSize = central.readUInt32LE(at + 20);
      const size = central.readUInt32LE(at + 24);
      const nameLength = central.readUInt16LE(at + 28);
      const extraLength = central.readUInt16LE(at + 30);
      const commentLength = central.readUInt16LE(at + 32);
      const startDisk = central.readUInt16LE(at + 34);
      const external = central.readUInt32LE(at + 38);
      const offset = central.readUInt32LE(at + 42);
      const recordEnd = at + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
      if (recordEnd > central.length) refuse('archive', "The archive's directory is damaged.");
      const nameBytes = central.subarray(
        at + CENTRAL_HEADER_BYTES,
        at + CENTRAL_HEADER_BYTES + nameLength,
      );
      at = recordEnd;

      let name: string;
      try {
        name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
      } catch {
        name = refuse('unsafe_path', 'An entry name is not valid UTF-8.');
      }
      if (flags & (ENCRYPTED_FLAG | STRONG_ENCRYPTION_FLAG)) {
        refuse('archive', `"${name}" is encrypted. A package is never encrypted.`);
      }
      if (startDisk !== 0) refuse('archive', `"${name}" is on another disk of a split archive.`);
      if ([compressedSize, size, offset].includes(MAX_UINT32)) {
        refuse('too_large', `"${name}" uses ZIP64, which a package never needs.`);
      }

      const isFolder = name.endsWith('/');
      const path = isFolder ? name.slice(0, -1) : name;
      if (path.split('/').some(isOsNoise)) continue;
      const problem = packagePathProblem(path);
      if (problem !== null) refuse('unsafe_path', `The archive entry "${name}" ${problem}.`);
      const type = entryType(madeBy, external);
      if (type === 'link') {
        refuse('link', `"${path}" is a link. A package holds only plain files.`);
      }
      if (type === 'special') refuse('link', `"${path}" isn't a plain file.`);
      if (isFolder || type === 'folder') {
        if (size !== 0) refuse('archive', `"${path}" is a folder with data in it.`);
        folders.add(sameFileKey(path));
        continue;
      }
      if (method !== STORE && method !== DEFLATE) {
        refuse('archive', `"${path}" uses a compression method packages don't use.`);
      }
      const key = sameFileKey(path);
      const earlier = names.get(key);
      if (earlier !== undefined) {
        refuse(
          'unsafe_path',
          `"${path}" and "${earlier}" would be the same file on Windows and macOS.`,
        );
      }
      names.set(key, path);
      if (size > limits.maxFileBytes) {
        refuse('too_large', `"${path}" unpacks to more than a package file may hold.`);
      }
      total += size;
      if (total > limits.maxTotalBytes) {
        refuse('too_large', 'The archive unpacks to more than a package may hold.');
      }
      if (method === STORE && compressedSize !== size) {
        refuse('archive', `"${path}" is stored, yet its two sizes differ.`);
      }
      if (size > RATIO_FLOOR_BYTES && size > compressedSize * MAX_RATIO) {
        refuse(
          'too_large',
          `"${path}" expands ${Math.round(size / Math.max(1, compressedSize))} times; that is a decompression bomb, not a package file.`,
        );
      }
      entries.push({ path, method, crc, compressedSize, size, dataStart: offset });
    }
    if (at !== central.length) refuse('archive', "The archive's directory is damaged.");

    for (const entry of entries) {
      const parts = entry.path.split('/');
      for (let depth = 1; depth < parts.length; depth += 1) {
        const parent = sameFileKey(parts.slice(0, depth).join('/'));
        const clash = names.get(parent);
        if (clash !== undefined) {
          refuse('unsafe_path', `"${clash}" is a file and also a folder holding "${entry.path}".`);
        }
      }
      if (folders.has(sameFileKey(entry.path))) {
        refuse('unsafe_path', `"${entry.path}" is a file and also a folder.`);
      }
    }

    const located: { entry: ZipEntry; headerAt: number }[] = [];
    for (const entry of entries) {
      const headerAt = entry.dataStart;
      const header = await readAt(handle, headerAt, LOCAL_HEADER_BYTES);
      if (header.readUInt32LE(0) !== LOCAL_HEADER) {
        refuse('archive', `"${entry.path}" isn't where the archive's directory says.`);
      }
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      const localName = await readAt(handle, headerAt + LOCAL_HEADER_BYTES, nameLength);
      if (localName.toString('utf8') !== entry.path || header.readUInt16LE(8) !== entry.method) {
        refuse('archive', `"${entry.path}" has a different name or method in its own header.`);
      }
      const dataStart = headerAt + LOCAL_HEADER_BYTES + nameLength + extraLength;
      if (dataStart + entry.compressedSize > centralOffset) {
        refuse('archive', `"${entry.path}" runs into the archive's directory.`);
      }
      located.push({ entry: { ...entry, dataStart }, headerAt });
    }
    const byStart = [...located].sort((a, b) => a.headerAt - b.headerAt);
    for (let index = 1; index < byStart.length; index += 1) {
      const before = byStart[index - 1];
      const next = byStart[index];
      if (!before || !next) continue;
      if (before.entry.dataStart + before.entry.compressedSize > next.headerAt) {
        refuse('archive', `"${next.entry.path}" overlaps "${before.entry.path}" in the archive.`);
      }
    }
    return located.map(({ entry }) => entry);
  } finally {
    await handle.close();
  }
}

/** What an entry's external attributes say it is. Only plain files and folders are accepted. */
function entryType(madeBy: number, external: number): 'file' | 'folder' | 'link' | 'special' {
  const host = madeBy >> 8;
  if (host === 3) {
    const mode = (external >>> 16) & S_IFMT;
    if (mode === 0 || mode === S_IFREG) return 'file';
    if (mode === S_IFDIR) return 'folder';
    return mode === 0o120000 ? 'link' : 'special';
  }
  if (external & DOS_REPARSE_POINT) return 'link';
  return external & DOS_DIRECTORY ? 'folder' : 'file';
}

/**
 * Extracts checked entries into `target`, which must be empty or missing. Each file is created
 * new, inflated with a running count that stops at its declared size, and checked against its
 * CRC. Throws a PackageError, leaving `target` for the caller to remove.
 */
export async function extractZip(
  archive: string,
  entries: readonly ZipEntry[],
  target: string,
): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const entry of entries) {
    const file = join(target, ...entry.path.split('/'));
    await mkdir(dirname(file), { recursive: true });
    let crc = 0;
    let written = 0;
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, callback: TransformCallback) {
        written += chunk.length;
        if (written > entry.size) {
          callback(
            new PackageError('too_large', [
              `"${entry.path}" unpacks to more than the archive declares.`,
            ]),
          );
          return;
        }
        crc = crc32(chunk, crc);
        callback(null, chunk);
      },
    });
    const sink = createWriteStream(file, { flags: 'wx' });
    try {
      if (entry.compressedSize === 0) {
        await pipeline(async function* () {}, guard, sink);
      } else {
        const source = createReadStream(archive, {
          start: entry.dataStart,
          end: entry.dataStart + entry.compressedSize - 1,
        });
        if (entry.method === DEFLATE) await pipeline(source, createInflateRaw(), guard, sink);
        else await pipeline(source, guard, sink);
      }
    } catch (error) {
      if (error instanceof PackageError) throw error;
      throw new PackageError('archive', [
        `"${entry.path}" couldn't be unpacked: ${error instanceof Error ? error.message : String(error)}.`,
      ]);
    }
    if (written !== entry.size || crc >>> 0 !== entry.crc >>> 0) {
      throw new PackageError('checksum', [
        `"${entry.path}" doesn't match the archive's own checksum; the archive is damaged.`,
      ]);
    }
  }
}
