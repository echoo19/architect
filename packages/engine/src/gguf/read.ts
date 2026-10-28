import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import {
  GGUF_DEFAULT_ALIGNMENT,
  GGUF_MAGIC,
  GGUF_MAX_DIMS,
  GGUF_VALUE_TYPES,
  GgufError,
  ggmlTypeById,
  tensorBytes,
  type GgufHeader,
  type GgufTensorInfo,
  type GgufValue,
  type GgufValueTypeName,
} from './types';

/** Random access to the bytes of a file or a buffer. */
export interface ByteSource {
  readonly size: number;
  /** Up to `length` bytes from `position`; fewer only at the end. */
  read(position: number, length: number): Uint8Array;
}

export interface ReadGgufOptions {
  /**
   * Array items kept per metadata array; the rest are skipped. A base model's vocabulary holds
   * hundreds of thousands of strings that validation never needs. Default 16.
   */
  maxArrayItems?: number;
}

/** Sanity limits that stop a corrupt header from asking for absurd amounts of memory. */
const MAX_STRING_BYTES = 64 * 1024 * 1024;
const MAX_TENSORS = 1_000_000;
const MAX_METADATA = 100_000;
const CHUNK = 1024 * 1024;

const FIXED_SIZES: Partial<Record<GgufValueTypeName, number>> = {
  uint8: 1,
  int8: 1,
  uint16: 2,
  int16: 2,
  uint32: 4,
  int32: 4,
  float32: 4,
  bool: 1,
  uint64: 8,
  int64: 8,
  float64: 8,
};

/** Reads forward through a source, keeping one window of it in memory. */
class Cursor {
  private window = Buffer.alloc(0);
  private windowStart = 0;
  position = 0;

  constructor(private readonly source: ByteSource) {}

  private need(length: number): Buffer {
    const end = this.position + length;
    if (end > this.source.size) {
      throw new GgufError('The file ends inside its header.');
    }
    const inWindow =
      this.position >= this.windowStart && end <= this.windowStart + this.window.length;
    if (!inWindow) {
      const want = Math.min(Math.max(length, CHUNK), this.source.size - this.position);
      this.window = Buffer.from(this.source.read(this.position, want));
      this.windowStart = this.position;
      if (this.window.length < length) throw new GgufError('The file ends inside its header.');
    }
    const at = this.position - this.windowStart;
    this.position = end;
    return this.window.subarray(at, at + length);
  }

  skip(length: number): void {
    if (this.position + length > this.source.size) {
      throw new GgufError('The file ends inside its header.');
    }
    this.position += length;
  }

  u8 = (): number => this.need(1).readUInt8(0);
  i8 = (): number => this.need(1).readInt8(0);
  u16 = (): number => this.need(2).readUInt16LE(0);
  i16 = (): number => this.need(2).readInt16LE(0);
  u32 = (): number => this.need(4).readUInt32LE(0);
  i32 = (): number => this.need(4).readInt32LE(0);
  f32 = (): number => this.need(4).readFloatLE(0);
  f64 = (): number => this.need(8).readDoubleLE(0);
  u64 = (): bigint => this.need(8).readBigUInt64LE(0);
  i64 = (): bigint => this.need(8).readBigInt64LE(0);

  /** A u64 that must fit in a JavaScript number, such as a count, a size or an offset. */
  count(what: string): number {
    const value = this.u64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new GgufError(`The header gives ${what} as ${value}, which is too large.`);
    }
    return Number(value);
  }

  string(): string {
    const length = this.count('a string length');
    if (length > MAX_STRING_BYTES) {
      throw new GgufError(`The header holds a string of ${length} bytes, which is too long.`);
    }
    return this.need(length).toString('utf8');
  }

  skipString(): void {
    const length = this.count('a string length');
    this.skip(length);
  }
}

function valueType(id: number): GgufValueTypeName {
  const name = GGUF_VALUE_TYPES[id];
  if (name === undefined) throw new GgufError(`The header uses an unknown value type (${id}).`);
  return name;
}

function readValue(cursor: Cursor, type: GgufValueTypeName, maxItems: number): GgufValue {
  switch (type) {
    case 'uint8':
      return { type, value: cursor.u8() };
    case 'int8':
      return { type, value: cursor.i8() };
    case 'uint16':
      return { type, value: cursor.u16() };
    case 'int16':
      return { type, value: cursor.i16() };
    case 'uint32':
      return { type, value: cursor.u32() };
    case 'int32':
      return { type, value: cursor.i32() };
    case 'float32':
      return { type, value: cursor.f32() };
    case 'float64':
      return { type, value: cursor.f64() };
    case 'uint64':
      return { type, value: cursor.u64() };
    case 'int64':
      return { type, value: cursor.i64() };
    case 'bool': {
      const byte = cursor.u8();
      if (byte > 1) throw new GgufError(`A boolean in the header holds ${byte}.`);
      return { type, value: byte === 1 };
    }
    case 'string':
      return { type, value: cursor.string() };
    case 'array': {
      const itemType = valueType(cursor.u32());
      const length = cursor.count('an array length');
      const items: GgufValue[] = [];
      const kept = Math.min(length, maxItems);
      for (let index = 0; index < kept; index++) items.push(readValue(cursor, itemType, maxItems));
      skipItems(cursor, itemType, length - kept, maxItems);
      return { type, itemType, length, items };
    }
  }
}

function skipItems(cursor: Cursor, type: GgufValueTypeName, count: number, maxItems: number): void {
  const size = FIXED_SIZES[type];
  if (size !== undefined) {
    cursor.skip(size * count);
    return;
  }
  for (let index = 0; index < count; index++) {
    if (type === 'string') cursor.skipString();
    else readValue(cursor, type, maxItems);
  }
}

/** Parses the header of a GGUF file: its metadata and the description of every tensor. */
export function parseGgufHeader(source: ByteSource, options: ReadGgufOptions = {}): GgufHeader {
  const maxItems = options.maxArrayItems ?? 16;
  if (source.size < 24) throw new GgufError('The file is too short to be a GGUF file.');
  const magic = Buffer.from(source.read(0, 4)).toString('latin1');
  if (magic !== GGUF_MAGIC) throw new GgufError('The file is not a GGUF file.');
  const cursor = new Cursor(source);
  cursor.skip(4);
  const version = cursor.u32();
  if (version !== 2 && version !== 3) {
    throw new GgufError(`The file is GGUF version ${version}; only versions 2 and 3 are read.`);
  }
  const tensorCount = cursor.count('the tensor count');
  const metadataCount = cursor.count('the metadata count');
  if (tensorCount > MAX_TENSORS || metadataCount > MAX_METADATA) {
    throw new GgufError('The header claims more tensors or metadata than any model has.');
  }

  const metadata = new Map<string, GgufValue>();
  for (let index = 0; index < metadataCount; index++) {
    const key = cursor.string();
    if (metadata.has(key)) throw new GgufError(`The metadata key ${key} appears twice.`);
    metadata.set(key, readValue(cursor, valueType(cursor.u32()), maxItems));
  }

  const alignmentValue = metadata.get('general.alignment');
  let alignment = GGUF_DEFAULT_ALIGNMENT;
  if (alignmentValue !== undefined) {
    if (alignmentValue.type !== 'uint32' || alignmentValue.value === 0) {
      throw new GgufError('general.alignment must be a positive uint32.');
    }
    alignment = alignmentValue.value;
  }

  const tensors: GgufTensorInfo[] = [];
  const names = new Set<string>();
  for (let index = 0; index < tensorCount; index++) {
    const name = cursor.string();
    if (names.has(name)) throw new GgufError(`The tensor ${name} appears twice.`);
    names.add(name);
    const dimCount = cursor.u32();
    if (dimCount < 1 || dimCount > GGUF_MAX_DIMS) {
      throw new GgufError(`The tensor ${name} has ${dimCount} dimensions.`);
    }
    const dims: number[] = [];
    for (let dim = 0; dim < dimCount; dim++) {
      const size = cursor.count(`a dimension of ${name}`);
      if (size < 1) throw new GgufError(`The tensor ${name} has an empty dimension.`);
      dims.push(size);
    }
    const typeId = cursor.u32();
    const offset = cursor.count(`the offset of ${name}`);
    if (offset % alignment !== 0) {
      throw new GgufError(`The tensor ${name} is not aligned to ${alignment} bytes.`);
    }
    tensors.push({
      name,
      dims,
      typeId,
      typeName: ggmlTypeById(typeId)?.name ?? null,
      offset,
      bytes: tensorBytes(typeId, dims),
    });
  }

  const dataOffset = Math.ceil(cursor.position / alignment) * alignment;
  const dataBytes = source.size - dataOffset;
  for (const tensor of tensors) {
    if (tensor.bytes !== null && tensor.offset + tensor.bytes > dataBytes) {
      throw new GgufError(`The tensor ${tensor.name} runs past the end of the file.`);
    }
  }
  return { version, alignment, metadata, tensors, dataOffset, fileSize: source.size };
}

export function bufferSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: (position, length) => bytes.subarray(position, position + length),
  };
}

/** Reads a GGUF file's header without reading its tensors. */
export function readGgufHeader(path: string, options: ReadGgufOptions = {}): GgufHeader {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const source: ByteSource = {
      size,
      read(position, length) {
        const buffer = Buffer.alloc(length);
        const read = readSync(fd, buffer, 0, length, position);
        return buffer.subarray(0, read);
      },
    };
    return parseGgufHeader(source, options);
  } finally {
    closeSync(fd);
  }
}

/** Reads one tensor's raw bytes. For small tensors: adapters and test fixtures. */
export function readTensorBytes(path: string, header: GgufHeader, name: string): Buffer {
  const tensor = header.tensors.find((candidate) => candidate.name === name);
  if (!tensor) throw new GgufError(`The file has no tensor ${name}.`);
  if (tensor.bytes === null) throw new GgufError(`The tensor ${name} has an unknown type.`);
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(tensor.bytes);
    const read = readSync(fd, buffer, 0, tensor.bytes, header.dataOffset + tensor.offset);
    if (read !== tensor.bytes) throw new GgufError(`The tensor ${name} is cut short.`);
    return buffer;
  } finally {
    closeSync(fd);
  }
}
