import { LineBuffer } from './lines';

/**
 * Incremental parser for server-sent events. It only reports each event's `data`, which is all
 * the Chat Completions streams use; comments, `event:`, `id:` and `retry:` lines are skipped.
 */
export class SseParser {
  private readonly lines = new LineBuffer();
  private data: string[] = [];

  push(text: string): string[] {
    return this.consume(this.lines.push(text));
  }

  /** Call once the stream has closed: an event the server never terminated still counts. */
  end(): string[] {
    const events = this.consume(this.lines.flush());
    this.flushEvent(events);
    return events;
  }

  private consume(lines: string[]): string[] {
    const events: string[] = [];
    for (const line of lines) {
      if (line === '') this.flushEvent(events);
      else if (!line.startsWith(':')) this.addField(line);
    }
    return events;
  }

  private addField(line: string): void {
    const colon = line.indexOf(':');
    if ((colon === -1 ? line : line.slice(0, colon)) !== 'data') return;
    const value = colon === -1 ? '' : line.slice(colon + 1);
    this.data.push(value.startsWith(' ') ? value.slice(1) : value);
  }

  private flushEvent(events: string[]): void {
    const payload = this.data.join('\n');
    this.data = [];
    if (payload !== '') events.push(payload);
  }
}

/** The `data` payload of every event in a byte stream, in order. */
export async function* readSse(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for await (const chunk of chunks) {
    yield* parser.push(decoder.decode(chunk, { stream: true }));
  }
  yield* parser.push(decoder.decode());
  yield* parser.end();
}
