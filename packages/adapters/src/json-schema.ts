type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The schemas nested in a schema: its properties, items, alternatives and definitions. */
function children(node: Node): unknown[] {
  const named = (key: string) => (isNode(node[key]) ? Object.values(node[key]) : []);
  return [
    ...named('properties'),
    node['items'],
    ...list(node['anyOf']),
    ...list(node['allOf']),
    ...list(node['oneOf']),
    ...named('$defs'),
    ...named('definitions'),
  ];
}

/**
 * Whether a JSON schema fits OpenAI's strict subset, so it can be sent with `strict: true`: every
 * object lists all of its properties as required and allows no others. Strict mode refuses any
 * other schema outright, so a schema that doesn't fit is sent without it.
 */
export function fitsStrictSubset(schema: unknown): boolean {
  if (!isNode(schema)) return true;
  if (schema['type'] === 'object') {
    if (schema['additionalProperties'] !== false) return false;
    const required = list(schema['required']);
    const properties = isNode(schema['properties']) ? Object.keys(schema['properties']) : [];
    if (!properties.every((key) => required.includes(key))) return false;
  }
  return children(schema).every(fitsStrictSubset);
}
