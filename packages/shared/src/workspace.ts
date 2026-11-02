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
const LeafStepViewSchema = z.discriminatedUnion('kind', [
  TableViewSchema.extend({ kind: z.literal('table') }),
  z.object({ kind: z.literal('code'), code: z.string(), output: z.string() }),
]);

const StepFields = {
  id: z.string(),
  /** Tool or skill name, e.g. `read`. */
  name: z.string(),
  /** What it acted on, e.g. `data/invoices.csv`. */
  detail: z.string(),
  /** Result summary once done, e.g. `412 lines`. */
  meta: z.string().optional(),
  status: z.enum(['running', 'done', 'error']),
  ms: z.number().int().nonnegative().optional(),
};

/**
 * A step of a teammate's work inside a consultation: a plain step, which can't itself be a
 * consultation, so a teammate never asks anyone in turn (decision 100).
 */
export const LeafStepSchema = z.object({
  ...StepFields,
  kind: z.enum(['skill', 'tool', 'wait', 'attempt']),
  /** What the step showed, for steps that have more than a summary. */
  view: LeafStepViewSchema.optional(),
});
export type LeafStep = z.infer<typeof LeafStepSchema>;

/**
 * How a consultation ended, as the lead was told: the teammate answered, refused the request,
 * finished without an answer it could give, failed, was stopped, or ran out of steps.
 */
export const ConsultationOutcomeSchema = z.enum([
  'answered',
  'refused',
  'no_answer',
  'error',
  'stopped',
  'out_of_steps',
]);
export type ConsultationOutcome = z.infer<typeof ConsultationOutcomeSchema>;

/**
 * How a step shows what it did: the rows a table read showed, the code `run` ran and its output,
 * or, for a consultation, the teammate that answered, its version, its own steps and, once it
 * has settled, how it ended.
 */
export const StepViewSchema = z.discriminatedUnion('kind', [
  ...LeafStepViewSchema.options,
  z.object({
    kind: z.literal('consult'),
    graduateId: z.string(),
    version: z.number().int().positive(),
    steps: z.array(LeafStepSchema),
    outcome: ConsultationOutcomeSchema.optional(),
  }),
]);
export type StepView = z.infer<typeof StepViewSchema>;

export const AgentStepSchema = z
  .object({
    ...StepFields,
    /**
     * `wait`: the reply waits its turn for the GPU while another of Architect's processes has it;
     * `detail` says for whom, and the step goes once the reply has the GPU. `attempt`: one of a
     * certified version's k attempts at the request (decision 077); `detail` is its answer and
     * `meta` whether it agrees with the most common one. `consult`: the lead asked a teammate
     * (decision 100); `name` is the teammate, `detail` the request and `meta` its answer.
     */
    kind: z.enum(['skill', 'tool', 'wait', 'attempt', 'consult']),
    /** What the step showed, for steps that have more than a summary. */
    view: StepViewSchema.optional(),
  })
  .refine(
    (step) => (step.kind === 'consult') === (step.view?.kind === 'consult'),
    "A consultation, and only a consultation, shows a teammate's work.",
  );
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const RowDiffSchema = z.object({
  columns: z.array(z.string()),
  added: z.array(z.array(CellValueSchema)),
  removed: z.array(z.array(CellValueSchema)),
  changed: z.array(z.object({ before: z.array(CellValueSchema), after: z.array(CellValueSchema) })),
});
export type RowDiff = z.infer<typeof RowDiffSchema>;

/** The teammate a write in a team reply is for, so the person knows whose files it changes. */
export const TeammateRefSchema = z.object({ graduateId: z.string(), name: z.string() });
export type TeammateRef = z.infer<typeof TeammateRefSchema>;

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
    /** In a team reply, the teammate whose write it is; absent for the agent that answers. */
    agent: TeammateRefSchema.optional(),
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
  /** In a team reply, the teammate whose write it is. */
  agent: TeammateRefSchema.optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/**
 * One step of a reply's work as the model took it: what the model said and the calls it made,
 * each call's result as the model saw it, a skill a rule loaded, or a refusal. Arguments and
 * results are kept as the JSON text or text they were. The steps a chat shows summarize these.
 */
export const ReplyStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('model'),
    text: z.string(),
    calls: z.array(z.object({ id: z.string(), name: z.string(), arguments: z.string() })),
  }),
  z.object({
    kind: z.literal('tool'),
    callId: z.string(),
    name: z.string(),
    arguments: z.string(),
    result: z.string(),
    error: z.string().optional(),
  }),
  z.object({ kind: z.literal('skill'), slug: z.string(), via: z.enum(['rule', 'tool']) }),
  z.object({ kind: z.literal('refusal'), taskType: z.string(), reason: z.string() }),
]);
export type ReplyStep = z.infer<typeof ReplyStepSchema>;

/**
 * One time a lead asked a teammate (decision 100): the request as the lead wrote it, the
 * teammate's whole work and what it answered, kept so Teach this can go to whoever did the work.
 */
export const ConsultationSchema = z.object({
  /** The consult step that shows it in the reply. */
  stepId: z.string(),
  graduateId: z.string(),
  /** The teammate's version that answered. */
  version: z.number().int().positive(),
  request: z.string(),
  work: z.array(ReplyStepSchema),
  /** What the lead got back. */
  text: z.string(),
  /** How it ended; absent while the teammate is still working. */
  outcome: ConsultationOutcomeSchema.optional(),
});
export type Consultation = z.infer<typeof ConsultationSchema>;

export const WorkspaceMessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(['user', 'agent']),
  createdAt: z.iso.datetime(),
  text: z.string(),
  steps: z.array(AgentStepSchema).default([]),
  /**
   * A settled reply's whole work, step by step, kept with it so Teach this can show the mentor
   * the exchange in full once the person agrees. Absent on user messages, on replies still being
   * written, and on replies from before it was kept.
   */
  trace: z.array(ReplyStepSchema).optional(),
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
  /**
   * The tokens the local runtime counted as written in the reply's model turns, and the time those
   * turns took, for its speed. Absent on user messages and on replies from before it was kept.
   */
  generated: z
    .object({ tokens: z.number().int().nonnegative(), ms: z.number().int().nonnegative() })
    .optional(),
  /** The graduate version that answered. Absent on user messages and on replies from before versions. */
  graduateVersion: z.number().int().positive().optional(),
  /** In a team chat, each time the reply asked a teammate, kept as each one goes. */
  consultations: z.array(ConsultationSchema).optional(),
  /**
   * A team reply (decision 100): its lead answered once, with its teammates' help, and no
   * certificate covers that, whatever the lead's or teammates' versions carry.
   */
  team: z.literal(true).optional(),
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
  /** A team chat's team; `graduateId` is then its lead, who answers. */
  teamId: z.string().optional(),
});
export type WorkspaceChat = z.infer<typeof WorkspaceChatSchema>;

/** Streamed from the agent host to the UI while a message is being worked on. */
export const WorkspaceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.updated'), message: WorkspaceMessageSchema }),
  z.object({ type: z.literal('chat.updated'), chat: WorkspaceChatSchema }),
]);
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;

/**
 * A network call the agent host's guard stopped before a byte left: graduates reach only this
 * computer, so any other destination is refused. Never a whole URL.
 */
export const BlockedConnectionSchema = z.object({
  /** The function that was called, e.g. `fetch` or `net.Socket.connect`. */
  api: z.string(),
  /** Where it tried to go: a host and port, a pipe, or a DNS query. */
  target: z.string(),
  at: z.iso.datetime(),
});
export type BlockedConnection = z.infer<typeof BlockedConnectionSchema>;
