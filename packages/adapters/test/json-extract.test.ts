import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../src/json-extract';

function value(text: string): unknown {
  const result = extractJsonObject(text);
  if (!result.ok) throw new Error(`expected an object, got: ${result.error}`);
  return result.value;
}

function error(text: string): string {
  const result = extractJsonObject(text);
  if (result.ok) throw new Error(`expected a failure, got: ${JSON.stringify(result.value)}`);
  return result.error;
}

describe('extractJsonObject', () => {
  it('reads a bare object', () => {
    expect(value('{"title":"Fix rounding","edits":[]}')).toEqual({
      title: 'Fix rounding',
      edits: [],
    });
    expect(value('  \n{"a":1}\n ')).toEqual({ a: 1 });
  });

  it('reads an object from a fenced json block and ignores the prose around it', () => {
    const reply = 'Here is my plan.\n\n```json\n{"a": 1, "b": {"c": [1, 2]}}\n```\n\nLet me know.';
    expect(value(reply)).toEqual({ a: 1, b: { c: [1, 2] } });
  });

  it('reads a fenced block without a language tag, and CRLF line endings', () => {
    expect(value('```\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(value('```JSON\r\n{"a":1}\r\n```')).toEqual({ a: 1 });
  });

  it('prefers a block marked json over an earlier unmarked one', () => {
    const reply = '```\n{"example":true}\n```\nFinal:\n```json\n{"answer":42}\n```';
    expect(value(reply)).toEqual({ answer: 42 });
  });

  it('takes the first object when there are several', () => {
    expect(value('{"first":1} and then {"second":2}')).toEqual({ first: 1 });
  });

  it('is not fooled by braces and quotes inside strings', () => {
    expect(value('{"a":"}{ not a brace","b":"say \\"hi\\" }"}')).toEqual({
      a: '}{ not a brace',
      b: 'say "hi" }',
    });
  });

  it('skips balanced braces in prose that are not JSON', () => {
    expect(value('I will use {the usual format} here: {"ok":true}')).toEqual({ ok: true });
  });

  it('keeps unicode intact', () => {
    expect(value('```json\n{"note":"café 😀 \\u00e9"}\n```')).toEqual({ note: 'café 😀 é' });
  });

  it('falls back to the text outside a fence when the fenced block is not an object', () => {
    expect(value('```\nnpm run build\n```\n{"a":1}')).toEqual({ a: 1 });
  });
});

describe('extractJsonObject failures', () => {
  it('says so for an empty reply and for a reply with no object', () => {
    expect(error('')).toBe('The reply was empty.');
    expect(error('   \n')).toBe('The reply was empty.');
    expect(error('I could not find a fix.')).toBe('The reply contains no JSON object.');
  });

  it('reports the parse error for a malformed object', () => {
    expect(error('{"a":1,}')).toMatch(/JSON/);
    expect(error('```json\n{"a": undefined}\n```')).toMatch(/JSON/);
  });

  it('does not return an inner object when the outer one is malformed', () => {
    const reply = '{"title":"x","edits":[{"op":"write","path":"a.md","content":"b"},],}';
    expect(error(reply)).toMatch(/JSON/);
  });

  it('does not return an inner object when the reply was cut off mid-object', () => {
    const reply =
      '```json\n{"title":"x","edits":[{"op":"write","path":"a.md","content":"b"},{"op":"wr';
    expect(error(reply)).toContain('not closed');
  });

  it('does not accept JSON that is not an object', () => {
    expect(error('"just a string"')).toBe('The reply contains no JSON object.');
    expect(error('[1, 2, 3]')).toBe('The reply contains no JSON object.');
  });

  it('keeps the first, most specific error when later candidates have none', () => {
    expect(error('```json\n{"a":}\n```\nand no more')).toMatch(/JSON/);
  });
});
