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
    /** `append` adds rows; `update` changes rows that are already there. */
    op: z.enum(['append', 'update']),
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

/** A write that needed the user's approval when no one could give it. */
export const ApprovalRequestSchema = z.object({
  changeId: z.string(),
  /** The write tool that asked, e.g. `append_rows`. */
  tool: z.string(),
  file: z.string(),
  summary: z.string(),
  diff: RowDiffSchema,
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
