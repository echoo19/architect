import { HypothesisSchema, type Hypothesis, type JsonSchemaObject } from '@architect/shared';
import { z } from 'zod';

/**
 * The reply format the author is asked for. It suits constrained decoding: the root is an
 * object, every object forbids extra keys and requires all of its keys, and edits are one flat
 * shape with empty content for a delete.
 */
export const HYPOTHESIS_JSON_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'diagnosis', 'causeTaskIds', 'edits', 'predicted', 'readyClaim'],
  properties: {
    title: { type: 'string', description: 'A short name for the change, at most 80 characters.' },
    diagnosis: {
      type: 'string',
      description: 'The root cause shared by the most failures, and the evidence for it.',
    },
    causeTaskIds: {
      type: 'array',
      description: 'Ids of the train tasks whose failures this change addresses.',
      items: { type: 'string' },
    },
    edits: {
      type: 'array',
      description: 'The change set: whole-file writes and deletes inside the harness surface.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'path', 'content'],
        properties: {
          op: { type: 'string', enum: ['write', 'delete'] },
          path: { type: 'string', description: 'Relative to the harness folder.' },
          content: {
            type: 'string',
            description: 'The complete new file for a write; empty for a delete.',
          },
        },
      },
    },
    predicted: {
      type: 'object',
      additionalProperties: false,
      required: ['devDeltaMin', 'devDeltaMax', 'rationale'],
      properties: {
        devDeltaMin: { type: 'integer', description: 'Lowest expected change in dev passes.' },
        devDeltaMax: { type: 'integer', description: 'Highest expected change in dev passes.' },
        rationale: { type: 'string' },
      },
    },
    readyClaim: {
      type: 'boolean',
      description: 'True only if you expect the requirement to be met on unseen tasks.',
    },
  },
};

const HypothesisReplySchema = z.object({
  title: z.string(),
  diagnosis: z.string(),
  causeTaskIds: z.array(z.string()),
  edits: z.array(
    z.object({ op: z.enum(['write', 'delete']), path: z.string(), content: z.string() }),
  ),
  predicted: z.object({
    devDeltaMin: z.number().int(),
    devDeltaMax: z.number().int(),
    rationale: z.string(),
  }),
  readyClaim: z.boolean(),
});

/** The author's reply couldn't be used. The round fails with this message; the loop goes on. */
export class MentorReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MentorReplyError';
  }
}

const TITLE_MAX = 80;

/** Pulls the JSON object out of a free-text reply, with or without a code fence around it. */
export function extractJson(text: string): unknown {
  const end = text.lastIndexOf('}');
  for (let start = text.indexOf('{'); start !== -1 && start < end;) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Prose before the object can hold a brace too; try the next one.
      start = text.indexOf('{', start + 1);
    }
  }
  return undefined;
}

function describeIssues(error: z.ZodError): string {
  const text = z.prettifyError(error).replace(/\s+/g, ' ').trim();
  return text.length > 400 ? `${text.slice(0, 399)}…` : text;
}

/**
 * Maps the reply onto the shared hypothesis and validates it. Cause ids the author couldn't
 * have seen are dropped, and a reversed prediction range is put in order.
 */
export function parseHypothesis(
  reply: { json?: unknown; text: string },
  visibleTaskIds: ReadonlySet<string>,
): Hypothesis {
  const raw = reply.json ?? extractJson(reply.text);
  if (raw === undefined) throw new MentorReplyError('The reply contained no JSON object.');
  const parsed = HypothesisReplySchema.safeParse(raw);
  if (!parsed.success) {
    throw new MentorReplyError(`The reply wasn't a hypothesis: ${describeIssues(parsed.error)}`);
  }
  const { title, predicted, ...rest } = parsed.data;
  const trimmed = title.trim();
  const hypothesis = HypothesisSchema.safeParse({
    title: trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed,
    diagnosis: rest.diagnosis,
    edits: rest.edits.map((edit) =>
      edit.op === 'delete'
        ? { op: 'delete', path: edit.path }
        : { op: 'write', path: edit.path, content: edit.content },
    ),
    causeTaskIds: rest.causeTaskIds.filter((id) => visibleTaskIds.has(id)),
    predicted: {
      devDeltaMin: Math.min(predicted.devDeltaMin, predicted.devDeltaMax),
      devDeltaMax: Math.max(predicted.devDeltaMin, predicted.devDeltaMax),
      rationale: predicted.rationale,
    },
    readyClaim: rest.readyClaim,
  });
  if (!hypothesis.success) {
    throw new MentorReplyError(`The hypothesis was invalid: ${describeIssues(hypothesis.error)}`);
  }
  return hypothesis.data;
}
