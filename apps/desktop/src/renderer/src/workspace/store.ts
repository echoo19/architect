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

function loadChats(graduateId: string): Promise<void> {
  return loadOnce(`chats:${graduateId}`, async () => {
    dispatch({ type: 'chats.loading', graduateId });
    try {
      dispatch({ type: 'chats.loaded', graduateId, chats: await api.chats(graduateId) });
    } catch (error) {
      dispatch({ type: 'chats.failed', graduateId, error: toError(error).message });
    }
  });
}

function loadMessages(chatId: string): Promise<void> {
  return loadOnce(`messages:${chatId}`, async () => {
    dispatch({ type: 'messages.loading', chatId });
    try {
      dispatch({ type: 'messages.loaded', chatId, messages: await api.messages(chatId) });
    } catch (error) {
      dispatch({ type: 'messages.failed', chatId, error: toError(error).message });
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

export function useAgentChats(graduateId: string): ListState<WorkspaceChat[]> {
  const entry = useWorkspace((state) => state.chats[graduateId]);
  useEffect(() => {
    if (!useWorkspace.getState().chats[graduateId]) void loadChats(graduateId);
  }, [graduateId]);
  const reload = useCallback(() => void loadChats(graduateId), [graduateId]);
  return { entry: entry ?? { status: 'loading' }, reload };
}

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
    if (entry?.status === 'error') throw new Error(entry.error);
  }
  const chats = entries.flatMap((entry) => entry?.data ?? []);
  const latest = chats.reduce<WorkspaceChat | undefined>(
    (best, chat) => (!best || chat.updatedAt > best.updatedAt ? chat : best),
    undefined,
  );
  const first = graduateIds[0];
  if (latest) return latest;
  if (!first) throw new Error('There are no agents to open.');
  return createChat(first);
}

/** Starts a chat and adds it to its agent's list, ready to open. */
export async function createChat(graduateId: string): Promise<WorkspaceChat> {
  const chat = await workspaceApi.createChat(graduateId);
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
