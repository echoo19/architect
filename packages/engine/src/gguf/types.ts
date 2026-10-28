/**
 * The GGUF file format (version 3): a header of typed key-value metadata and tensor descriptions,
 * then the tensor data, each tensor aligned to `general.alignment` bytes (32 by default). Shapes
 * are in ggml order: the first dimension is the row length, so a weight that maps n_in features
 * to n_out has dims [n_in, n_out].
 */

export const GGUF_MAGIC = 'GGUF';
export const GGUF_VERSION = 3;
export const GGUF_DEFAULT_ALIGNMENT = 32;
/** ggml supports at most four dimensions. */
export const GGUF_MAX_DIMS = 4;

/** The value types a metadata entry can hold, by their id in the file. */
export const GGUF_VALUE_TYPES = [
  'uint8',
  'int8',
  'uint16',
  'int16',
  'uint32',
  'int32',
  'float32',
  'bool',
  'string',
  'array',
  'uint64',
  'int64',
  'float64',
] as const;
export type GgufValueTypeName = (typeof GGUF_VALUE_TYPES)[number];
export type GgufScalarTypeName = Exclude<GgufValueTypeName, 'array'>;
export type GgufNumberTypeName = Exclude<
  GgufScalarTypeName,
  'bool' | 'string' | 'uint64' | 'int64'
>;

export type GgufValue =
  | { type: GgufNumberTypeName; value: number }
  | { type: 'uint64' | 'int64'; value: bigint }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | {
      type: 'array';
      itemType: GgufValueTypeName;
      /** How many items the file holds. */
      length: number;
      /** The items read; fewer than `length` when the reader was told to keep only the first. */
      items: GgufValue[];
    };

export interface GgmlType {
  id: number;
  name: string;
  /** Elements per block. */
  blockSize: number;
  /** Bytes per block. */
  typeSize: number;
}

/** ggml's tensor types that a GGUF file may use, from ggml.h and ggml-common.h. */
export const GGML_TYPES: readonly GgmlType[] = [
  { id: 0, name: 'F32', blockSize: 1, typeSize: 4 },
  { id: 1, name: 'F16', blockSize: 1, typeSize: 2 },
  { id: 2, name: 'Q4_0', blockSize: 32, typeSize: 18 },
  { id: 3, name: 'Q4_1', blockSize: 32, typeSize: 20 },
  { id: 6, name: 'Q5_0', blockSize: 32, typeSize: 22 },
  { id: 7, name: 'Q5_1', blockSize: 32, typeSize: 24 },
  { id: 8, name: 'Q8_0', blockSize: 32, typeSize: 34 },
  { id: 9, name: 'Q8_1', blockSize: 32, typeSize: 36 },
  { id: 10, name: 'Q2_K', blockSize: 256, typeSize: 84 },
  { id: 11, name: 'Q3_K', blockSize: 256, typeSize: 110 },
  { id: 12, name: 'Q4_K', blockSize: 256, typeSize: 144 },
  { id: 13, name: 'Q5_K', blockSize: 256, typeSize: 176 },
  { id: 14, name: 'Q6_K', blockSize: 256, typeSize: 210 },
  { id: 15, name: 'Q8_K', blockSize: 256, typeSize: 292 },
  { id: 16, name: 'IQ2_XXS', blockSize: 256, typeSize: 66 },
  { id: 17, name: 'IQ2_XS', blockSize: 256, typeSize: 74 },
  { id: 18, name: 'IQ3_XXS', blockSize: 256, typeSize: 98 },
  { id: 19, name: 'IQ1_S', blockSize: 256, typeSize: 50 },
  { id: 20, name: 'IQ4_NL', blockSize: 32, typeSize: 18 },
  { id: 21, name: 'IQ3_S', blockSize: 256, typeSize: 110 },
  { id: 22, name: 'IQ2_S', blockSize: 256, typeSize: 82 },
  { id: 23, name: 'IQ4_XS', blockSize: 256, typeSize: 136 },
  { id: 24, name: 'I8', blockSize: 1, typeSize: 1 },
  { id: 25, name: 'I16', blockSize: 1, typeSize: 2 },
  { id: 26, name: 'I32', blockSize: 1, typeSize: 4 },
  { id: 27, name: 'I64', blockSize: 1, typeSize: 8 },
  { id: 28, name: 'F64', blockSize: 1, typeSize: 8 },
  { id: 29, name: 'IQ1_M', blockSize: 256, typeSize: 56 },
  { id: 30, name: 'BF16', blockSize: 1, typeSize: 2 },
  { id: 34, name: 'TQ1_0', blockSize: 256, typeSize: 54 },
  { id: 35, name: 'TQ2_0', blockSize: 256, typeSize: 66 },
  { id: 39, name: 'MXFP4', blockSize: 32, typeSize: 17 },
];

const TYPES_BY_ID = new Map(GGML_TYPES.map((type) => [type.id, type]));
const TYPES_BY_NAME = new Map(GGML_TYPES.map((type) => [type.name, type]));

export function ggmlTypeById(id: number): GgmlType | null {
  return TYPES_BY_ID.get(id) ?? null;
}

export function ggmlTypeByName(name: string): GgmlType | null {
  return TYPES_BY_NAME.get(name) ?? null;
}

/** Bytes a tensor of this type and shape takes, or null for a type this table doesn't know. */
export function tensorBytes(typeId: number, dims: readonly number[]): number | null {
  const type = ggmlTypeById(typeId);
  if (!type) return null;
  const [rowLength = 1, ...rest] = dims;
  if (rowLength % type.blockSize !== 0) return null;
  const rows = rest.reduce((product, dim) => product * dim, 1);
  return (rowLength / type.blockSize) * type.typeSize * rows;
}

export interface GgufTensorInfo {
  name: string;
  /** In ggml order: [n_in, n_out] for a weight. */
  dims: number[];
  /** The ggml type id. */
  typeId: number;
  /** The type's name, or null when this table doesn't know the id. */
  typeName: string | null;
  /** From the start of the data section. */
  offset: number;
  /** Null when the type is unknown. */
  bytes: number | null;
}

export interface GgufHeader {
  version: number;
  alignment: number;
  metadata: ReadonlyMap<string, GgufValue>;
  tensors: readonly GgufTensorInfo[];
  /** Where the data section starts in the file. */
  dataOffset: number;
  /** The whole file's size in bytes. */
  fileSize: number;
}

/** A file that is not a GGUF file Architect can read, or a header that contradicts itself. */
export class GgufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GgufError';
  }
}

export function metadataString(header: GgufHeader, key: string): string | null {
  const value = header.metadata.get(key);
  return value?.type === 'string' ? value.value : null;
}

/** A numeric metadata value, whatever its width; null when absent, not a number or too large. */
export function metadataNumber(header: GgufHeader, key: string): number | null {
  const value = header.metadata.get(key);
  if (!value || value.type === 'array' || value.type === 'string' || value.type === 'bool') {
    return null;
  }
  const number = value.value;
  if (typeof number === 'bigint') {
    const safe =
      number <= BigInt(Number.MAX_SAFE_INTEGER) && number >= BigInt(Number.MIN_SAFE_INTEGER);
    return safe ? Number(number) : null;
  }
  return number;
}
