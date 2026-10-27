import type { ChatMessage } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { callId, countToolCalls, parseToolArguments } from '../src/tool-calls';

describe('countToolCalls', () => {
  it('counts the calls in assistant turns only', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'a', arguments: {} },
          { id: 'call_2', name: 'b', arguments: {} },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', name: 'a', content: '1' },
      { role: 'tool', toolCallId: 'call_2', name: 'b', content: '2' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_3', name: 'c', arguments: {} }] },
      { role: 'assistant', content: 'done' },
    ];
    expect(countToolCalls(messages)).toBe(3);
    expect(countToolCalls([])).toBe(0);
  });
});

describe('callId', () => {
  it('is derived from the position and nothing else', () => {
    expect(callId(1)).toBe('call_1');
    expect(callId(12)).toBe(callId(12));
  });
});

describe('parseToolArguments', () => {
  it('parses JSON text into an object', () => {
    expect(parseToolArguments('{"a":[1,{"b":null}]}', 'f', 'Host')).toEqual({
      a: [1, { b: null }],
    });
  });

  it('passes an object through', () => {
    expect(parseToolArguments({ a: 1 }, 'f', 'Host')).toEqual({ a: 1 });
  });

  it('treats empty text, null and undefined as no arguments', () => {
    for (const raw of ['', '  ', null, undefined]) {
      expect(parseToolArguments(raw, 'f', 'Host'), String(raw)).toEqual({});
    }
  });

  it('names the tool and the service when the arguments are unusable', () => {
    for (const raw of ['{"a":', '[1]', '"text"', '3', [1, 2], 7]) {
      expect(() => parseToolArguments(raw, 'read_table', 'Host'), String(raw)).toThrow(
        /Host sent a call to "read_table" whose arguments aren't/,
      );
    }
  });
});
