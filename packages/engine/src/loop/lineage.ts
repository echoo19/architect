import { LineageEntrySchema, type LineageEntry } from '@architect/shared';
import { readJsonLines, writeJsonLines } from './files';

/**
 * A run's `lineage.jsonl`: one entry per tested hypothesis, the record of every harness change
 * with its cause, prediction and measured effect. The database only indexes it.
 */
export class LineageLog {
  constructor(private readonly file: string) {}

  async read(): Promise<LineageEntry[]> {
    return (await readJsonLines(this.file)).map((line) => LineageEntrySchema.parse(line));
  }

  /**
   * Records the round's entry once. A decision retried after a restart gets back the entry
   * already written, so the file never holds two entries for a round.
   */
  async record(entry: LineageEntry): Promise<LineageEntry> {
    const entries = await this.read();
    const existing = entries.find((candidate) => candidate.round === entry.round);
    if (existing) return existing;
    await writeJsonLines(this.file, [...entries, LineageEntrySchema.parse(entry)]);
    return entry;
  }
}
