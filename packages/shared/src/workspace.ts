import { z } from 'zod';
import { CellValueSchema } from './cells';

/** Rows that a read of a table showed, with the table's column names. */
export const TableViewSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string().nullable())),
  /** The table's data rows in all, of which these are some. */
  total: z.number().int().nonnegative(),
});
export type TableView = z.infer<typeof TableViewSchema>;

/** How a step shows what it did: the rows a table read showed, or the code `run` ran and its output. */
export const StepViewSchema = z.discriminatedUnion('kind', [
  TableViewSchema.extend({ kind: z.literal('table') }),
  z.object({ kind: z.literal('code'), code: z.string(), output: z.string() }),
]);
export type StepView = z.infer<typeof StepViewSchema>;

export const AgentStepSchema = z.object({
  id: z.string(),
  kind: z.enum(['skill', 'tool']),
  /** Tool or skill name, e.g. `read`. */
  name: z.string(),
  /** What it acted on, e.g. `data/invoices.csv`. */
  detail: z.string(),
  /** Result summary once done, e.g. `412 lines`. */
  meta: z.string().optional(),
  status: z.enum(['running', 'done', 'error']),
  ms: z.number().int().nonnegative().optional(),
  /** What the step showed, for steps that have more than a summary. */
  view: StepViewSchema.optional(),
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
    /**
     * The tool that asks: `write`, `edit` or `append`. Chats from before the coding tools hold
     * `update` (rows changed) and `append` (rows added).
     */
    op: z.enum(['write', 'edit', 'append', 'update']),
    /** The file it changes, e.g. `data/invoices.csv`. */
    file: z.string(),
    /** e.g. "Add 1 row to data/invoices.csv" */
    summary: z.string(),
    /** For a table: the rows the change adds, removes and changes. */
    diff: RowDiffSchema.optional(),
    /** For any other file: the change as a unified diff. */
    patch: z.string().optional(),
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
export const WorkspaceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.updated'), message: WorkspaceMessageSchema }),
  z.object({ type: z.literal('chat.updated'), chat: WorkspaceChatSchema }),
]);
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;
