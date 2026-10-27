import { describe, expect, it } from 'vitest';
import { parseAnswerLine } from '../src/agent/answer';

describe('parseAnswerLine', () => {
  it.each([
    [
      'plain',
      'Done.\nANSWER: {"invoice_id": "INV-4", "total_cents": 1200}',
      { invoice_id: 'INV-4', total_cents: 1200 },
    ],
    ['the last answer line wins', 'ANSWER: 1\nOn second thought:\nANSWER: 2', 2],
    ['backticks around the line', '`ANSWER: ["INV-1", "INV-2"]`', ['INV-1', 'INV-2']],
    ['backticks around the JSON', 'ANSWER: `{"a": 1}`', { a: 1 }],
    ['an inline fence', 'ANSWER: ```json {"a": 1}```', { a: 1 }],
    ['inside a fence', 'Here it is:\n```\nANSWER: {"a": 1}\n```', { a: 1 }],
    ['a fenced block after the line', 'ANSWER:\n```json\n{\n  "a": 1\n}\n```\nThanks.', { a: 1 }],
    ['JSON that continues on the next lines', 'ANSWER: {\n  "a": [1,\n 2]\n}', { a: [1, 2] }],
    ['leading spaces and CRLF', 'ok\r\n   ANSWER: 42  \r\n', 42],
    [
      'a text answer that follows the line',
      'ANSWER: {"a": 1}\nLet me know if you need anything else.',
      { a: 1 },
    ],
    ['an explicit null', 'ANSWER: null', null],
  ])('reads %s', (_, text, expected) => {
    expect(parseAnswerLine(text)).toEqual({ answer: expected });
  });

  it.each([
    ['no answer line', 'The total is 1200 cents.', 'No line starts with ANSWER:'],
    ['a lowercase prefix', 'answer: {"a": 1}', 'No line starts with ANSWER:'],
    ['bold markdown', '**ANSWER:** {"a": 1}', 'No line starts with ANSWER:'],
    ['nothing after the prefix', 'ANSWER:', 'The ANSWER: line has no JSON after it.'],
  ])('reports %s', (_, text, error) => {
    expect(parseAnswerLine(text)).toEqual({ answer: null, error });
  });

  it('parses JSON strictly', () => {
    for (const text of [
      "ANSWER: {'a': 1}",
      'ANSWER: {"a": 1,}',
      'ANSWER: {"a": 1} and that is all',
      'ANSWER: total 5',
    ]) {
      const parsed = parseAnswerLine(text);
      expect(parsed.answer).toBeNull();
      expect(parsed.error).toMatch(/^The JSON after ANSWER: is not valid: /);
    }
  });
});
