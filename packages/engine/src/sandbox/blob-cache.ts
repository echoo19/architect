import type { TableSnapshot } from '../data/types';
import { contentHash, TableSnapshotSchema } from './protocol';
import type { BlobReader } from './vm';

interface Entry {
  raw: string;
  table?: TableSnapshot;
}

/**
 * The child's copy of table snapshots and texts, keyed by content hash so the engine sends each
 * version once. Least recently used entries go first when the cache grows past its limit.
 */
export class BlobCache implements BlobReader {
  private readonly entries = new Map<string, Entry>();
  private size = 0;

  constructor(private readonly limitChars: number) {}

  add(hash: string, raw: string): void {
    if (contentHash(raw) !== hash) throw new Error('A data blob did not match its content hash.');
    if (this.entries.has(hash)) return;
    this.entries.set(hash, { raw });
    this.size += raw.length;
  }

  has(hash: string): boolean {
    return this.entries.has(hash);
  }

  /** Marks the hashes as just used, then evicts other entries while over the limit. */
  retain(hashes: readonly string[]): void {
    for (const hash of hashes) {
      const entry = this.entries.get(hash);
      if (!entry) continue;
      this.entries.delete(hash);
      this.entries.set(hash, entry);
    }
    const keep = new Set(hashes);
    for (const [hash, entry] of this.entries) {
      if (this.size <= this.limitChars) return;
      if (keep.has(hash)) continue;
      this.entries.delete(hash);
      this.size -= entry.raw.length;
    }
  }

  table(hash: string): TableSnapshot {
    const entry = this.entry(hash);
    entry.table ??= TableSnapshotSchema.parse(JSON.parse(entry.raw));
    return entry.table;
  }

  text(hash: string): string {
    return this.entry(hash).raw;
  }

  private entry(hash: string): Entry {
    const entry = this.entries.get(hash);
    if (!entry) throw new Error(`The sandbox lost data blob ${hash}.`);
    return entry;
  }
}
