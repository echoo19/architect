import { useCallback, useEffect } from 'react';
import type { WorkspaceChat, WorkspaceMessage } from '@architect/shared';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { api, architect } from '../api/client';
import { toError } from '../api/query';
import { onWorkspaceEvent, workspaceApi } from './api';
import {
  emptyWorkspace,
  unusedChat,
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

/**
 * The chats of each of these teams, newest first across them, for the home of the agent that
 * leads them. Teams whose chats can't be read yet are left out until they are.
 */
export function useTeamsChats(teamIds: readonly string[]): WorkspaceChat[] {
  const entries = useWorkspace(useShallow((state) => teamIds.map((id) => state.chats[id])));
  const key = teamIds.join(' ');
  useEffect(() => {
    const { chats } = useWorkspace.getState();
    for (const id of key === '' ? [] : key.split(' ')) {
      if (!chats[id]) void loadTeamChats(id);
    }
  }, [key]);
  return entries.flatMap((entry) => entry?.data ?? []);
}

/**
 * The messages of every one of these chats, each read once and kept in step with the host like an
 * open chat's: what an agent's home counts. Ready once every chat's messages are read, the first
 * failure otherwise.
 */
export function useChatsMessages(chatIds: readonly string[]): {
  entry: Loadable<Record<string, WorkspaceMessage[]>>;
  reload: () => void;
} {
  const entries = useWorkspace(useShallow((state) => chatIds.map((id) => state.messages[id])));
  const key = chatIds.join(' ');
  useEffect(() => {
    const { messages } = useWorkspace.getState();
    for (const id of key === '' ? [] : key.split(' ')) {
      if (!messages[id]) void loadMessages(id);
    }
  }, [key]);
  const reload = useCallback(() => {
    for (const id of key === '' ? [] : key.split(' ')) void loadMessages(id);
  }, [key]);
  const failure = entries.find((entry) => entry?.status === 'error');
  if (failure?.status === 'error')
    return { entry: { status: 'error', error: failure.error }, reload };
  if (entries.some((entry) => entry?.data === undefined)) {
    return { entry: { status: 'loading' }, reload };
  }
  const data = Object.fromEntries(chatIds.map((id, index) => [id, entries[index]?.data ?? []]));
  return { entry: { status: 'ready', data }, reload };
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

/** The agent among these that was used last, or the first when none has a chat yet. */
export async function latestAgent(graduateIds: string[]): Promise<string> {
  await Promise.all(graduateIds.map((id) => loadChats(id)));
  const entries = graduateIds.map((id) => useWorkspace.getState().chats[id]);
  for (const entry of entries) {
    if (entry?.status === 'error') throw entry.error;
  }
  const first = graduateIds[0];
  const id = newest(entries.flatMap((entry) => entry?.data ?? []))?.graduateId ?? first;
  if (id === undefined) throw new Error('There are no agents to open.');
  return id;
}

function newest(chats: readonly WorkspaceChat[]): WorkspaceChat | undefined {
  return chats.reduce<WorkspaceChat | undefined>(
    (best, chat) => (!best || chat.updatedAt > best.updatedAt ? chat : best),
    undefined,
  );
}

/**
 * Starts a chat and adds it to its agent's list, ready to open: or the agent's empty chat, when
 * it already has one.
 */
export async function createChat(graduateId: string): Promise<WorkspaceChat> {
  const unused = unusedChat(useWorkspace.getState(), graduateId);
  return unused ?? opened(await workspaceApi.createChat(graduateId));
}

/** Starts a chat with a team, or opens its empty one, as `createChat` does for an agent. */
export async function createTeamChat(teamId: string): Promise<WorkspaceChat> {
  const unused = unusedChat(useWorkspace.getState(), teamId);
  return unused ?? opened(await workspaceApi.createTeamChat(teamId));
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
