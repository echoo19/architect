import { useCallback, useEffect } from 'react';
import type { WorkspaceChat, WorkspaceMessage } from '@architect/shared';
import { create } from 'zustand';
import { api, architect } from '../api/client';
import { toError } from '../api/query';
import { onWorkspaceEvent, workspaceApi } from './api';
import {
  emptyWorkspace,
  workspaceReducer,
  type Loadable,
  type WorkspaceAction,
  type WorkspaceState,
} from './reducer';

/**
 * Chats and messages for every agent, kept in step with the agent host: loads go through the
 * bridge, and live events from the host go through the same reducer.
 */
const useWorkspace = create<WorkspaceState & { dispatch: (action: WorkspaceAction) => void }>()(
  (set) => ({
    ...emptyWorkspace(),
    dispatch: (action) => set((state) => workspaceReducer(state, action)),
  }),
);

const dispatch = (action: WorkspaceAction) => useWorkspace.getState().dispatch(action);

const inflight = new Map<string, Promise<void>>();

/** Shares one request per key, so two screens asking at once cause one load. */
function loadOnce(key: string, load: () => Promise<void>): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const request = load().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Reads one list of chats: an agent's own, or a team's (`owner` is the team's id). */
function loadList(owner: string, read: () => Promise<WorkspaceChat[]>): Promise<void> {
  return loadOnce(`chats:${owner}`, async () => {
    dispatch({ type: 'chats.loading', owner });
    try {
      dispatch({ type: 'chats.loaded', owner, chats: await read() });
    } catch (error) {
      dispatch({ type: 'chats.failed', owner, error: toError(error) });
    }
  });
}

const loadChats = (graduateId: string) => loadList(graduateId, () => api.chats(graduateId));
const loadTeamChats = (teamId: string) => loadList(teamId, () => api.teamChats(teamId));

function loadMessages(chatId: string): Promise<void> {
  return loadOnce(`messages:${chatId}`, async () => {
    dispatch({ type: 'messages.loading', chatId });
    try {
      dispatch({ type: 'messages.loaded', chatId, messages: await api.messages(chatId) });
    } catch (error) {
      dispatch({ type: 'messages.failed', chatId, error: toError(error) });
    }
  });
}

let listening = false;

/**
 * Applies the host's live events to the store. The subscription lasts for the whole session,
 * so a chat that finishes while another screen is open still shows as finished.
 */
export function useWorkspaceEvents(): void {
  useEffect(() => {
    if (listening) return;
    listening = true;
    onWorkspaceEvent(dispatch);
  }, []);
}

export interface ListState<T> {
  entry: Loadable<T>;
  reload: () => void;
}

function useChatList(
  owner: string,
  load: (owner: string) => Promise<void>,
): ListState<WorkspaceChat[]> {
  const entry = useWorkspace((state) => state.chats[owner]);
  useEffect(() => {
    if (!useWorkspace.getState().chats[owner]) void load(owner);
  }, [owner, load]);
  const reload = useCallback(() => void load(owner), [owner, load]);
  return { entry: entry ?? { status: 'loading' }, reload };
}

/** An agent's own chats, without the chats of the teams it leads. */
export const useAgentChats = (graduateId: string) => useChatList(graduateId, loadChats);

/** A team's chats, which its lead answers. */
export const useTeamChats = (teamId: string) => useChatList(teamId, loadTeamChats);

export function useChatMessages(chatId: string): ListState<WorkspaceMessage[]> {
  const entry = useWorkspace((state) => state.messages[chatId]);
  useEffect(() => {
    if (!useWorkspace.getState().messages[chatId]) void loadMessages(chatId);
  }, [chatId]);
  const reload = useCallback(() => void loadMessages(chatId), [chatId]);
  return { entry: entry ?? { status: 'loading' }, reload };
}

let finding: Promise<WorkspaceChat> | undefined;

/**
 * The chat to open when the workspace opens: the one used last across these agents, or a new
 * one with the first agent when none has a chat yet. Calls made while one is running share it,
 * so an agent never gets two new chats.
 */
export function latestChat(graduateIds: string[]): Promise<WorkspaceChat> {
  finding ??= findLatestChat(graduateIds).finally(() => {
    finding = undefined;
  });
  return finding;
}

async function findLatestChat(graduateIds: string[]): Promise<WorkspaceChat> {
  await Promise.all(graduateIds.map((id) => loadChats(id)));
  const entries = graduateIds.map((id) => useWorkspace.getState().chats[id]);
  for (const entry of entries) {
    if (entry?.status === 'error') throw entry.error;
  }
  const latest = newest(entries.flatMap((entry) => entry?.data ?? []));
  const first = graduateIds[0];
  if (latest) return latest;
  if (!first) throw new Error('There are no agents to open.');
  return createChat(first);
}

/** The team chat used last, or a new one when the team has none yet. */
export async function latestTeamChat(teamId: string): Promise<WorkspaceChat> {
  await loadTeamChats(teamId);
  const entry = useWorkspace.getState().chats[teamId];
  if (entry?.status === 'error') throw entry.error;
  return newest(entry?.data ?? []) ?? createTeamChat(teamId);
}

function newest(chats: readonly WorkspaceChat[]): WorkspaceChat | undefined {
  return chats.reduce<WorkspaceChat | undefined>(
    (best, chat) => (!best || chat.updatedAt > best.updatedAt ? chat : best),
    undefined,
  );
}

/** Starts a chat and adds it to its agent's list, ready to open. */
export async function createChat(graduateId: string): Promise<WorkspaceChat> {
  return opened(await workspaceApi.createChat(graduateId));
}

/** Starts a chat with a team and adds it to the team's list, ready to open. */
export async function createTeamChat(teamId: string): Promise<WorkspaceChat> {
  return opened(await workspaceApi.createTeamChat(teamId));
}

function opened(chat: WorkspaceChat): WorkspaceChat {
  dispatch({ type: 'chat.updated', chat });
  dispatch({ type: 'messages.loaded', chatId: chat.id, messages: [] });
  return chat;
}

/**
 * Sends a message. The host streams the user's message and the reply back as events; reading
 * the chat once more afterwards also covers a host that only stores them.
 */
export async function sendMessage(chatId: string, text: string): Promise<void> {
  await architect().workspace.send(chatId, text);
  void loadMessages(chatId);
}

/** Drops a deleted agent's chats and messages. */
export function forgetAgent(graduateId: string): void {
  dispatch({ type: 'graduate.removed', graduateId });
}

/** Drops a deleted team's chats and messages. */
export function forgetTeam(teamId: string): void {
  dispatch({ type: 'team.removed', teamId });
}
