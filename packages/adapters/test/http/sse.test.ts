import { describe, expect, it } from 'vitest';
import { LineBuffer } from '../../src/http/lines';
import { readSse, SseParser } from '../../src/http/sse';

async function* chunked(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<string[]> {
  const events: string[] = [];
  for await (const event of readSse(chunks)) events.push(event);
  return events;
}

function splitAt(bytes: Uint8Array, index: number): Uint8Array[] {
  return [bytes.slice(0, index), bytes.slice(index)];
}

describe('LineBuffer', () => {
  it('returns complete lines and keeps the unfinished tail', () => {
    const lines = new LineBuffer();
    expect(lines.push('one\ntwo\nthr')).toEqual(['one', 'two']);
    expect(lines.push('ee\nfour')).toEqual(['three']);
    expect(lines.flush()).toEqual(['four']);
    expect(lines.flush()).toEqual([]);
  });

  it('treats \\r\\n, \\n and \\r as one terminator each', () => {
    expect(new LineBuffer().push('a\r\nb\nc\rd\r\n')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not invent a blank line when \\r\\n is split across chunks', () => {
    const lines = new LineBuffer();
    expect(lines.push('a\r')).toEqual(['a']);
    expect(lines.push('\nb\r\n')).toEqual(['b']);
  });

  it('keeps a real blank line', () => {
    expect(new LineBuffer().push('a\n\nb\n')).toEqual(['a', '', 'b']);
  });
});

describe('SseParser', () => {
  it('reports the data of each event', () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a":1}\n\ndata: {"a":2}\n\n')).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('waits for the blank line before reporting an event', () => {
    const parser = new SseParser();
    expect(parser.push('data: first\n')).toEqual([]);
    expect(parser.push('\n')).toEqual(['first']);
  });

  it('joins multi-line data with a newline', () => {
    expect(new SseParser().push('data: one\ndata: two\n\n')).toEqual(['one\ntwo']);
  });

  it('strips one leading space and accepts a missing one', () => {
    expect(new SseParser().push('data:tight\n\ndata:  loose\n\n')).toEqual(['tight', ' loose']);
  });

  it('skips comments, other fields and events without data', () => {
    const parser = new SseParser();
    const text =
      ': keep-alive\n\nevent: ping\nid: 7\nretry: 1000\n\nevent: x\ndata: kept\n\ndata:\n\n';
    expect(parser.push(text)).toEqual(['kept']);
  });

  it('reads CRLF line endings', () => {
    expect(new SseParser().push('data: a\r\n\r\ndata: b\r\n\r\n')).toEqual(['a', 'b']);
  });

  it('still reports an event the server never terminated', () => {
    const parser = new SseParser();
    expect(parser.push('data: last')).toEqual([]);
    expect(parser.end()).toEqual(['last']);
  });

  it('passes the [DONE] sentinel through as an ordinary payload', () => {
    expect(new SseParser().push('data: [DONE]\n\n')).toEqual(['[DONE]']);
  });
});

describe('readSse', () => {
  const stream = 'data: {"text":"héllo 😀"}\r\n\r\n: ping\n\ndata: [DONE]\n\n';
  const expected = ['{"text":"héllo 😀"}', '[DONE]'];

  it('gives the same events however the bytes are split, even inside a character', async () => {
    const bytes = new TextEncoder().encode(stream);
    for (let index = 0; index <= bytes.length; index++) {
      expect(await collect(chunked(...splitAt(bytes, index))), `split at ${index}`).toEqual(
        expected,
      );
    }
  });

  it('copes with one byte per chunk', async () => {
    const bytes = new TextEncoder().encode(stream);
    const single = Array.from(bytes, (byte) => new Uint8Array([byte]));
    expect(await collect(chunked(...single))).toEqual(expected);
  });

  it('yields nothing for an empty stream', async () => {
    expect(await collect(chunked())).toEqual([]);
  });
});
