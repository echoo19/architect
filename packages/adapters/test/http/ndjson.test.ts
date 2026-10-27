import { AdapterError } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { readNdjson } from '../../src/http/ndjson';

const encoder = new TextEncoder();

async function* chunked(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of readNdjson(chunks, 'Ollama')) values.push(value);
  return values;
}

describe('readNdjson', () => {
  const lines = '{"a":1}\n{"a":2,"s":"héllo 😀"}\n\n{"done":true}\n';
  const expected = [{ a: 1 }, { a: 2, s: 'héllo 😀' }, { done: true }];

  it('parses one value per line and skips blank lines', async () => {
    expect(await collect(chunked(encoder.encode(lines)))).toEqual(expected);
  });

  it('gives the same values however the bytes are split', async () => {
    const bytes = encoder.encode(lines);
    for (let index = 0; index <= bytes.length; index++) {
      const parts = [bytes.slice(0, index), bytes.slice(index)];
      expect(await collect(chunked(...parts)), `split at ${index}`).toEqual(expected);
    }
  });

  it('reads a last line that has no trailing newline', async () => {
    expect(await collect(chunked(encoder.encode('{"a":1}\n{"a":2}')))).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  it('reads CRLF line endings', async () => {
    expect(await collect(chunked(encoder.encode('{"a":1}\r\n{"a":2}\r\n')))).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  it('reports a line that is not JSON as a bad response from the service', async () => {
    const error = await collect(chunked(encoder.encode('{"a":1}\nnot json\n'))).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('bad_response');
    expect((error as AdapterError).message).toContain('Ollama');
  });
});
