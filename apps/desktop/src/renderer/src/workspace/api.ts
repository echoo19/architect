import {
  GraduateSettingsSchema,
  WorkspaceChatSchema,
  WorkspaceEventSchema,
  type GraduateSettings,
  type Unsubscribe,
  type WorkspaceEvent,
} from '@architect/shared';
import type { z } from 'zod';
import { architect } from '../api/client';

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
};

/** Live changes to chats and messages. Events that don't match the contract are dropped. */
export function onWorkspaceEvent(listener: (event: WorkspaceEvent) => void): Unsubscribe {
  return architect().workspace.onEvent((payload) => {
    const event = WorkspaceEventSchema.safeParse(payload);
    if (event.success) listener(event.data);
    else console.error("[workspace] An event didn't match the contract.", event.error);
  });
}
