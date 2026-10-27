import type { ChatMessage, ToolSpec } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { toWireMessages, toWireTools } from '../../src/openai/messages';

const conversation: ChatMessage[] = [
  { role: 'system', content: 'You are the service desk.' },
  { role: 'user', content: 'Total invoice 12.' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 'call_1', name: 'read_table', arguments: { name: 'invoices.csv', limit: 5 } },
      { id: 'call_2', name: 'list_files', arguments: {} },
    ],
  },
  { role: 'tool', toolCallId: 'call_1', name: 'read_table', content: '[{"id":12}]' },
  { role: 'tool', toolCallId: 'call_2', name: 'list_files', content: '["invoices.csv"]' },
  { role: 'assistant', content: 'The total is $5.\nANSWER: {"total":500}' },
];

describe('toWireMessages', () => {
  it('maps a whole tool-using conversation', () => {
    expect(toWireMessages(conversation, { systemRole: 'system', toolNames: true })).toEqual([
      { role: 'system', content: 'You are the service desk.' },
      { role: 'user', content: 'Total invoice 12.' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_table', arguments: '{"name":"invoices.csv","limit":5}' },
          },
          { id: 'call_2', type: 'function', function: { name: 'list_files', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'read_table', content: '[{"id":12}]' },
      { role: 'tool', tool_call_id: 'call_2', name: 'list_files', content: '["invoices.csv"]' },
      { role: 'assistant', content: 'The total is $5.\nANSWER: {"total":500}' },
    ]);
  });

  it('calls system messages "developer" when asked to', () => {
    const [first] = toWireMessages(conversation, { systemRole: 'developer', toolNames: false });
    expect(first).toEqual({ role: 'developer', content: 'You are the service desk.' });
  });

  it('can leave the tool name off tool results', () => {
    const wire = toWireMessages(conversation, { systemRole: 'system', toolNames: false });
    expect(wire[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '[{"id":12}]' });
  });

  it('sends no tool_calls key for an assistant turn without calls', () => {
    const wire = toWireMessages(
      [
        { role: 'assistant', content: 'plain' },
        { role: 'assistant', content: 'empty list', toolCalls: [] },
      ],
      { systemRole: 'system', toolNames: true },
    );
    expect(wire[0]).toEqual({ role: 'assistant', content: 'plain' });
    expect(wire[1]).not.toHaveProperty('tool_calls');
  });

  it('keeps every call id in order so replies match their calls', () => {
    const wire = toWireMessages(conversation, { systemRole: 'system', toolNames: true });
    const assistant = wire[2];
    const calls = assistant?.role === 'assistant' ? assistant.tool_calls : undefined;
    const results = wire.flatMap((message) =>
      message.role === 'tool' ? [message.tool_call_id] : [],
    );
    expect(calls?.map((call) => call.id)).toEqual(results);
  });
});

describe('toWireTools', () => {
  it('nests each tool under function', () => {
    const tools: ToolSpec[] = [
      {
        name: 'read_table',
        description: 'Read rows from a table.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      },
    ];
    expect(toWireTools(tools)).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_table',
          description: 'Read rows from a table.',
          parameters: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
    ]);
  });
});
