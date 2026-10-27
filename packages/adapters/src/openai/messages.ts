import type { ChatMessage, JsonSchemaObject, ToolSpec } from '@architect/shared';

export type SystemRole = 'system' | 'developer';

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: SystemRole | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; name?: string; content: string };

export interface WireTool {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchemaObject };
}

export interface MessageStyle {
  /** What to call system messages: Meta wants `developer`, everyone else `system`. */
  systemRole: SystemRole;
  /** Whether tool results carry the tool's name next to the call id. */
  toolNames: boolean;
}

export function toWireMessages(
  messages: readonly ChatMessage[],
  style: MessageStyle,
): WireMessage[] {
  return messages.map((message): WireMessage => {
    switch (message.role) {
      case 'system':
        return { role: style.systemRole, content: message.content };
      case 'user':
        return { role: 'user', content: message.content };
      case 'assistant':
        return message.toolCalls?.length
          ? {
              role: 'assistant',
              content: message.content,
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : { role: 'assistant', content: message.content };
      case 'tool':
        return style.toolNames
          ? {
              role: 'tool',
              tool_call_id: message.toolCallId,
              name: message.name,
              content: message.content,
            }
          : { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
  });
}

export function toWireTools(tools: readonly ToolSpec[]): WireTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}
