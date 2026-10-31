import { z } from 'zod';

/**
 * Agent teams (decision 100). A team is a saved list of agents: the first leads, and only the
 * lead is asked. In a team chat the lead gets one extra tool, `ask_teammate`, that hands part of
 * the request to a teammate, who works on its own files in task mode and sees only what the lead
 * wrote. Only text crosses between them, and a teammate can't ask anyone in turn.
 */

/** The tool a lead asks a teammate with. Reserved, so no harness helper can take its name. */
export const ASK_TEAMMATE = 'ask_teammate';
/** A lead and at most three teammates. */
export const MAX_TEAM_MEMBERS = 4;
/** The most teammates one reply may ask, counting each ask. */
export const MAX_CONSULTATIONS = 4;
/** The longest request a lead may hand a teammate. */
export const TEAM_REQUEST_CHARS = 2000;

export const TeamMemberSchema = z
  .object({
    graduateId: z.string().min(1),
    /** One line on what the lead may ask it; its contract's summary when absent. */
    role: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/** The lead first, then its teammates, each agent once. */
const MembersSchema = z
  .array(TeamMemberSchema)
  .min(2)
  .max(MAX_TEAM_MEMBERS)
  .refine(
    (members) => new Set(members.map((member) => member.graduateId)).size === members.length,
    'List each agent once.',
  );

export const TeamSchema = z.object({
  id: z.string().regex(/^team_[a-z0-9]+$/),
  name: z.string().trim().min(1).max(60),
  members: MembersSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Team = z.infer<typeof TeamSchema>;

/** What a person sets when they make or edit a team. */
export const TeamInputSchema = z
  .object({ name: TeamSchema.shape.name, members: MembersSchema })
  .strict();
export type TeamInput = z.infer<typeof TeamInputSchema>;
