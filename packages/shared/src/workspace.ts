import { z } from 'zod';
import { CellValueSchema } from './cells';

export const AgentStepSchema = z.object({
  id: z.string(),
  kind: z.enum(['skill', 'tool']),
  /** Tool or skill name, e.g. `read_table`. */
  name: z.string(),
  /** What it acted on, e.g. `invoices.csv`. */
  detail: z.string(),
  /** Result summary once done, e.g. `412 rows`. */
  meta: z.string().optional(),
  status: z.enum(['running', 'done', 'error']),
  ms: z.number().int().nonnegative().optional(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const RowDiffSchema = z.object({
  columns: z.array(z.string()),
  added: z.array(z.array(CellValueSchema)),
  removed: z.array(z.array(CellValueSchema)),
  changed: z.array(z.object({ before: z.array(CellValueSchema), after: z.array(CellValueSchema) })),
});
export type RowDiff = z.infer<typeof RowDiffSchema>;

export const AgentBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(z.string()),
    rows: z.array(z.array(CellValueSchema)),
  }),
  z.object({
    kind: z.literal('approval'),
    changeId: z.string(),
    file: z.string(),
    /** e.g. "Append 1 row to invoices.csv" */
    summary: z.string(),
    diff: RowDiffSchema,
    status: z.enum(['pending', 'approved', 'denied']),
  }),
  z.object({ kind: z.literal('refusal'), taskType: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('note'), text: z.string() }),
]);
export type AgentBlock = z.infer<typeof AgentBlockSchema>;

export const WorkspaceMessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(['user', 'agent']),
  createdAt: z.iso.datetime(),
  text: z.string(),
  steps: z.array(AgentStepSchema).default([]),
  blocks: z.array(AgentBlockSchema).default([]),
  status: z.enum(['streaming', 'done', 'stopped', 'error']),
  error: z.string().optional(),
  workedMs: z.number().int().nonnegative().optional(),
});
export type WorkspaceMessage = z.infer<typeof WorkspaceMessageSchema>;

export const WorkspaceChatSchema = z.object({
  id: z.string(),
  graduateId: z.string(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  running: z.boolean(),
  /** True when an approval is waiting for the user. */
  waiting: z.boolean(),
});
export type WorkspaceChat = z.infer<typeof WorkspaceChatSchema>;

/** Streamed from the agent host to the UI while a message is being worked on. */
export type WorkspaceEvent =
  | { type: 'message.updated'; message: WorkspaceMessage }
  | { type: 'chat.updated'; chat: WorkspaceChat };
