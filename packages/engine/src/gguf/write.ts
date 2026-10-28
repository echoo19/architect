import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { endianness } from 'node:os';
import {
  GGUF_DEFAULT_ALIGNMENT,
  GGUF_MAGIC,
  GGUF_MAX_DIMS,
  GGUF_VALUE_TYPES,
  GGUF_VERSION,
  GgufError,
  ggmlTypeByName,
  tensorBytes,
  type GgufValue,
  type GgufValueTypeName,
} from './types';

export interface GgufTensorSource {
  name: string;
  /** In ggml order: [n_in, n_out] for a weight. */
  dims: readonly number[];
  /** A ggml type name such as F32. */
  type: string;
  /** The tensor's bytes, asked for only when the writer reaches it. */
  bytes(): Uint8Array;
}

export interface GgufWriteSpec {
  /** Written in this order. */
  metadata: ReadonlyArray<readonly [string, GgufValue]>;
  tensors: readonly GgufTensorSource[];
  /** Default 32; any other value is written as `general.alignment`. */
  alignment?: number;
}

const TYPE_IDS = new Map<GgufValueTypeName, number>(GGUF_VALUE_TYPES.map((name, id) => [name, id]));

function typeId(name: GgufValueTypeName): number {
  const id = TYPE_IDS.get(name);
  if (id === undefined) throw new GgufError(`Unknown value type ${name}.`);
  return id;
}

class ByteWriter {
  private readonly parts: Buffer[] = [];
  length = 0;

  push(buffer: Buffer): void {
    this.parts.push(buffer);
    this.length += buffer.length;
  }

  u32(value: number): void {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value);
    this.push(buffer);
  }

  u64(value: number | bigint): void {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    this.push(buffer);
  }

  string(value: string): void {
    const bytes = Buffer.from(value, 'utf8');
    this.u64(bytes.length);
    this.push(bytes);
  }

  value(value: GgufValue): void {
    const buffer = (size: number, write: (target: Buffer) => void) => {
      const target = Buffer.alloc(size);
      write(target);
      this.push(target);
    };
    switch (value.type) {
      case 'uint8':
        return buffer(1, (target) => target.writeUInt8(value.value));
      case 'int8':
        return buffer(1, (target) => target.writeInt8(value.value));
      case 'uint16':
        return buffer(2, (target) => target.writeUInt16LE(value.value));
      case 'int16':
        return buffer(2, (target) => target.writeInt16LE(value.value));
      case 'uint32':
        return buffer(4, (target) => target.writeUInt32LE(value.value));
      case 'int32':
        return buffer(4, (target) => target.writeInt32LE(value.value));
      case 'float32':
        return buffer(4, (target) => target.writeFloatLE(value.value));
      case 'float64':
        return buffer(8, (target) => target.writeDoubleLE(value.value));
      case 'uint64':
        return buffer(8, (target) => target.writeBigUInt64LE(value.value));
      case 'int64':
        return buffer(8, (target) => target.writeBigInt64LE(value.value));
      case 'bool':
        return buffer(1, (target) => target.writeUInt8(value.value ? 1 : 0));
      case 'string':
        return this.string(value.value);
      case 'array':
        if (value.items.length !== value.length) {
          throw new GgufError('An array to write must hold all of its items.');
        }
        this.u32(typeId(value.itemType));
        this.u64(value.length);
        for (const item of value.items) {
          if (item.type !== value.itemType) {
            throw new GgufError(`An array of ${value.itemType} holds a ${item.type}.`);
          }
          this.value(item);
        }
        return;
    }
  }

  concat(): Buffer {
    return Buffer.concat(this.parts, this.length);
  }
}

const padding = (length: number, alignment: number): Buffer =>
  Buffer.alloc((alignment - (length % alignment)) % alignment);

interface Layout {
  header: Buffer;
  alignment: number;
  tensors: { source: GgufTensorSource; bytes: number }[];
}

function layout(spec: GgufWriteSpec): Layout {
  const alignment = spec.alignment ?? GGUF_DEFAULT_ALIGNMENT;
  if (!Number.isInteger(alignment) || alignment < 1) {
    throw new GgufError('The alignment must be a positive integer.');
  }
  const metadata = [...spec.metadata];
  const keys = new Set(metadata.map(([key]) => key));
  if (keys.size !== metadata.length) throw new GgufError('A metadata key is given twice.');
  if (keys.has('general.alignment')) {
    throw new GgufError('Set the alignment through the spec, not as metadata.');
  }
  if (alignment !== GGUF_DEFAULT_ALIGNMENT) {
    metadata.push(['general.alignment', { type: 'uint32', value: alignment }]);
  }

  const writer = new ByteWriter();
  writer.push(Buffer.from(GGUF_MAGIC, 'latin1'));
  writer.u32(GGUF_VERSION);
  writer.u64(spec.tensors.length);
  writer.u64(metadata.length);
  for (const [key, value] of metadata) {
    writer.string(key);
    writer.u32(typeId(value.type));
    writer.value(value);
  }

  const names = new Set<string>();
  const tensors: Layout['tensors'] = [];
  let offset = 0;
  for (const source of spec.tensors) {
    if (names.has(source.name)) throw new GgufError(`The tensor ${source.name} is given twice.`);
    names.add(source.name);
    const type = ggmlTypeByName(source.type);
    if (!type) throw new GgufError(`The tensor ${source.name} has an unknown type ${source.type}.`);
    if (source.dims.length < 1 || source.dims.length > GGUF_MAX_DIMS) {
      throw new GgufError(`The tensor ${source.name} must have one to four dimensions.`);
    }
    if (source.dims.some((dim) => !Number.isInteger(dim) || dim < 1)) {
      throw new GgufError(
        `The tensor ${source.name} has a dimension that is not a positive integer.`,
      );
    }
    const bytes = tensorBytes(type.id, source.dims);
    if (bytes === null) {
      throw new GgufError(`The rows of ${source.name} don't fill whole ${type.name} blocks.`);
    }
    writer.string(source.name);
    writer.u32(source.dims.length);
    for (const dim of source.dims) writer.u64(dim);
    writer.u32(type.id);
    writer.u64(offset);
    tensors.push({ source, bytes });
    offset += bytes + padding(bytes, alignment).length;
  }
  writer.push(padding(writer.length, alignment));
  return { header: writer.concat(), alignment, tensors };
}

function tensorData(tensor: Layout['tensors'][number]): Buffer {
  const data = tensor.source.bytes();
  if (data.length !== tensor.bytes) {
    throw new GgufError(
      `The tensor ${tensor.source.name} has ${data.length} bytes; its shape and type need ${tensor.bytes}.`,
    );
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/** The whole file in memory. For small files: tests and fixtures. */
export function encodeGguf(spec: GgufWriteSpec): Buffer {
  const { header, alignment, tensors } = layout(spec);
  const parts = [header];
  for (const tensor of tensors) {
    const data = tensorData(tensor);
    parts.push(data, padding(data.length, alignment));
  }
  return Buffer.concat(parts);
}

/**
 * Writes a GGUF file one tensor at a time, through a temporary file renamed into place, so a
 * reader never sees half a file.
 */
export function writeGgufFile(path: string, spec: GgufWriteSpec): void {
  const { header, alignment, tensors } = layout(spec);
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = openSync(temporary, 'w');
    try {
      writeSync(fd, header);
      for (const tensor of tensors) {
        const data = tensorData(tensor);
        writeSync(fd, data);
        writeSync(fd, padding(data.length, alignment));
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Little-endian bytes of 32-bit floats, as GGUF stores them. */
export function float32Bytes(values: Float32Array): Uint8Array {
  if (endianness() === 'LE')
    return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}
