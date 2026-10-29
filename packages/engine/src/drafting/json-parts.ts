import type { JsonSchemaObject } from '@architect/shared';

/** The small pieces the reply format's JSON Schema is built from. */

export const text = (description: string) => ({ type: 'string', description });

export const list = (description: string, items: object = { type: 'string' }) => ({
  type: 'array',
  description,
  items,
});

/** An object whose every property is required and that allows no others, as strict decoding wants. */
export function objectOf(properties: Record<string, object>): JsonSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
