import { writeFile } from 'node:fs/promises';
import { crc32, deflateRawSync } from 'node:zlib';
import type { ManifestDraft } from '../src';

/** A complete manifest draft, as graduation would write one, before its integrity section. */
export function sampleDraft(overrides: Partial<ManifestDraft> = {}): ManifestDraft {
  return {
    schema: 2,
    kind: 'architect.graduate',
    identity: {
      agentId: 'grd_sample',
      name: 'Service desk',
      version: 1,
      createdAt: '2026-11-05T18:00:00.000Z',
      method: 'architect',
    },
    contract: {
      version: 1,
      jobId: 'job_sample',
      name: 'Service desk',
      description: 'Invoices and overdue balances for a home-services office.',
      capabilities: {
        taskTypes: [{ id: 'invoice', label: 'Invoices' }],
        does: ['Prices completed jobs'],
        doesNot: ['Issues refunds'],
      },
      inputs: {
        request: 'text',
        files: [{ name: 'invoices.csv', kind: 'table', access: 'write' }],
      },
      outputs: { answer: 'text', files: ['invoices.csv'] },
      boundaries: { writes: 'ask', unseenFiles: 'never', network: 'none' },
      acceptance: { passRate: 0.9 },
    },
    model: {
      label: 'Glimmer',
      base: { name: 'muse-glimmer:30b', digest: 'sha256:abc', quantization: 'Q4_K_M' },
      inference: { contextLength: 16_384 },
      runtime: { compatible: ['ollama'] },
    },
    harness: { format: 1, path: 'harness', hash: 'sha256-harness', version: 3 },
    resources: [
      {
        name: 'data',
        kind: 'folder',
        required: true,
        description: "The job's records.",
        accepts: ['text/csv'],
        access: 'read_write',
        files: [{ name: 'invoices.csv', kind: 'table', access: 'write', columns: ['invoice_id'] }],
      },
    ],
    requirements: {
      tested: [{ os: 'win32', arch: 'x64', backend: 'ollama', target: 'local' }],
      measured: {},
      minimum: {},
      limitations: [],
    },
    evidence: {
      label: "Evaluated on the author's configuration",
      status: 'unevaluated',
      contractVersion: 1,
      counts: { testTasks: 0, rounds: 0, keptChanges: 0 },
    },
    verification: { checks: [], fixtures: [] },
    terms: { baseModel: "The base model's own licence applies.", notices: [] },
    ...overrides,
  };
}

export interface CraftedEntry {
  name: string;
  data?: Buffer;
  /** 0 stores, 8 deflates. */
  method?: number;
  flags?: number;
  madeBy?: number;
  externalAttributes?: number;
  /** Overrides the size written in the headers. */
  declaredSize?: number;
}

/**
 * Writes a ZIP byte by byte, so tests can build archives no well-behaved tool would make:
 * traversal names, links, lying sizes, encryption flags.
 */
export async function craftZip(file: string, entries: readonly CraftedEntry[]): Promise<void> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data ?? Buffer.alloc(0);
    const method = entry.method ?? 0;
    const body = method === 8 ? deflateRawSync(data) : data;
    const size = entry.declaredSize ?? data.length;
    const crc = crc32(data) >>> 0;
    const flags = (entry.flags ?? 0) | (1 << 11);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.madeBy ?? (3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.externalAttributes ?? 0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(file, Buffer.concat([...locals, directory, end]));
}
