import { z } from 'zod';
import { CellValueSchema } from './cells';
import { WRITE_TOOL_NAMES } from './data';

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
    /**
     * `failed`: it was allowed but couldn't be saved, and nothing was written. A pending change
     * with an `error` was allowed, couldn't be saved, and waits for the user to try again.
     */
    status: z.enum(['pending', 'approved', 'denied', 'failed']),
    /** Why the allowed change couldn't be saved. */
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal('refusal'), taskType: z.string(), reason: z.string() }),
  z.object({ kind: z.literal('note'), text: z.string() }),
]);
export type AgentBlock = z.infer<typeof AgentBlockSchema>;

/** A write that needed the user's approval when no one could give it. */
export const ApprovalRequestSchema = z.object({
  changeId: z.string(),
  /** The write tool that asked: `write`, `edit` or `append`. */
  tool: z.enum(WRITE_TOOL_NAMES),
  /** The file it would change, e.g. `data/invoices.csv`. */
  file: z.string(),
  summary: z.string(),
  /** For a table: the rows the change would add, remove and change. */
  diff: RowDiffSchema.optional(),
  /** For any other file: the change as a unified diff. */
  patch: z.string().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

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
  /**
   * Why a reply ended without finishing, as data a caller can act on. A reply that needed an
   * approval no one could give (a non-interactive run) ends `approval_required`.
   */
  failure: z
    .object({ kind: z.literal('approval_required'), approval: ApprovalRequestSchema })
    .optional(),
  workedMs: z.number().int().nonnegative().optional(),
  /** The graduate version that answered. Absent on user messages and on replies from before versions. */
  graduateVersion: z.number().int().positive().optional(),
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
  /** The graduate version that was active when the chat started. Each reply records its own. */
  graduateVersion: z.number().int().positive().optional(),
});
export type WorkspaceChat = z.infer<typeof WorkspaceChatSchema>;

/** Streamed from the agent host to the UI while a message is being worked on. */
export const WorkspaceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.updated'), message: WorkspaceMessageSchema }),
  z.object({ type: z.literal('chat.updated'), chat: WorkspaceChatSchema }),
]);
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;
