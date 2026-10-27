import { Document, isScalar, parseDocument, visit } from 'yaml';

/** YAML with short lists on one line, long strings unwrapped and a trailing newline. */
export function stringifyYaml(value: unknown): string {
  const doc = new Document(value);
  visit(doc, {
    Seq(_key, node) {
      if (node.items.every(isScalar)) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, indent: 2, flowCollectionPadding: false });
}

/** Parses YAML text. An empty document is `null`. Throws an Error whose message names the line. */
export function parseYaml(text: string): unknown {
  const doc = parseDocument(text);
  const [first] = doc.errors;
  if (first) throw new Error(firstLine(first.message).replace(/:$/, ''));
  return doc.toJS();
}

export function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? firstLine(error.message) : String(error);
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? text;
}
