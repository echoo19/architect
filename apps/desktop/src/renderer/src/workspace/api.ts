import {
  GraduateSettingsSchema,
  GraduateSummarySchema,
  WorkspaceChatSchema,
  WorkspaceMessageSchema,
  type GraduateSettings,
  type Unsubscribe,
  type WorkspaceEvent,
} from '@architect/shared';
import { z } from 'zod';
import { architect } from '../api/client';

/** The contract declares WorkspaceEvent as a type only; events are checked against this. */
const WorkspaceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.updated'), message: WorkspaceMessageSchema }),
  z.object({ type: z.literal('chat.updated'), chat: WorkspaceChatSchema }),
]) satisfies z.ZodType<WorkspaceEvent>;

/** Checks a reply against its contract, so a mismatch becomes an error people can read. */
async function parsed<T>(label: string, schema: z.ZodType<T>, request: Promise<unknown>) {
  const result = schema.safeParse(await request);
  if (result.success) return result.data;
  console.error(
    `[workspace] ${label} returned data that doesn't match the contract.`,
    result.error,
  );
  throw new Error(`Architect received data it couldn't read from ${label}.`);
}

export const workspaceApi = {
  createChat: (graduateId: string) =>
    parsed(
      'workspace.createChat',
      WorkspaceChatSchema,
      architect().workspace.createChat(graduateId),
    ),
  graduateSettings: (graduateId: string) =>
    parsed(
      'graduates.settings',
      GraduateSettingsSchema,
      architect().graduates.settings(graduateId),
    ),
  updateGraduateSettings: (graduateId: string, patch: Partial<GraduateSettings>) =>
    parsed(
      'graduates.updateSettings',
      GraduateSettingsSchema,
      architect().graduates.updateSettings(graduateId, patch),
    ),
  importGraduate: (path: string) =>
    parsed(
      'graduates.importFolder',
      GraduateSummarySchema,
      architect().graduates.importFolder(path),
    ),
};

/** Live changes to chats and messages. Events that don't match the contract are dropped. */
export function onWorkspaceEvent(listener: (event: WorkspaceEvent) => void): Unsubscribe {
  return architect().workspace.onEvent((payload) => {
    const event = WorkspaceEventSchema.safeParse(payload);
    if (event.success) listener(event.data);
    else console.error("[workspace] An event didn't match the contract.", event.error);
  });
}
