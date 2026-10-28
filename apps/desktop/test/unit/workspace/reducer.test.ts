import type { WorkspaceChat, WorkspaceMessage } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  emptyWorkspace,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from '../../../src/renderer/src/workspace/reducer';

const AT = '2026-10-27T15:00:00.000Z';

function message(id: string, patch: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  return {
    id,
    chatId: 'cht_1',
    role: 'agent',
    createdAt: AT,
    text: '',
    steps: [],
    blocks: [],
    status: 'done',
    ...patch,
  };
}

function chat(id: string, patch: Partial<WorkspaceChat> = {}): WorkspaceChat {
  return {
    id,
    graduateId: 'grd_1',
    title: id,
    createdAt: AT,
    updatedAt: AT,
    running: false,
    waiting: false,
    ...patch,
  };
}

const run = (actions: WorkspaceAction[], from: WorkspaceState = emptyWorkspace()) =>
  actions.reduce(workspaceReducer, from);

describe('workspaceReducer', () => {
  it('loads messages and chats', () => {
    const state = run([
      { type: 'messages.loading', chatId: 'cht_1' },
      { type: 'chats.loading', graduateId: 'grd_1' },
    ]);
    expect(state.messages.cht_1).toEqual({ status: 'loading' });
    expect(state.chats.grd_1).toEqual({ status: 'loading' });

    const loaded = run(
      [
        { type: 'messages.loaded', chatId: 'cht_1', messages: [message('msg_1')] },
        { type: 'chats.loaded', graduateId: 'grd_1', chats: [chat('cht_1')] },
      ],
      state,
    );
    expect(loaded.messages.cht_1).toEqual({ status: 'ready', data: [message('msg_1')] });
    expect(loaded.chats.grd_1).toEqual({ status: 'ready', data: [chat('cht_1')] });
  });

  it('keeps the last data while reloading and after a failed reload', () => {
    const loaded = run([{ type: 'messages.loaded', chatId: 'cht_1', messages: [message('m')] }]);
    const reloading = workspaceReducer(loaded, { type: 'messages.loading', chatId: 'cht_1' });
    expect(reloading.messages.cht_1).toEqual({ status: 'loading', data: [message('m')] });
    const failed = workspaceReducer(reloading, {
      type: 'messages.failed',
      chatId: 'cht_1',
      error: 'The engine stopped.',
    });
    expect(failed.messages.cht_1).toEqual({
      status: 'error',
      error: 'The engine stopped.',
      data: [message('m')],
    });
    const firstFailure = run([{ type: 'chats.failed', graduateId: 'grd_1', error: 'Nope.' }]);
    expect(firstFailure.chats.grd_1).toEqual({ status: 'error', error: 'Nope.' });
  });

  it('streams a reply: new messages are added, updates replace them in place', () => {
    const state = run([
      { type: 'messages.loaded', chatId: 'cht_1', messages: [message('msg_1', { role: 'user' })] },
      { type: 'message.updated', message: message('msg_2', { status: 'streaming' }) },
      {
        type: 'message.updated',
        message: message('msg_2', {
          status: 'streaming',
          steps: [
            { id: 's1', kind: 'tool', name: 'read', detail: 'data/jobs.csv', status: 'running' },
          ],
        }),
      },
      { type: 'message.updated', message: message('msg_2', { text: 'Done.', status: 'done' }) },
    ]);
    const messages = state.messages.cht_1?.data ?? [];
    expect(messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2']);
    expect(messages[1]).toMatchObject({ text: 'Done.', status: 'done' });
  });

  it('applies a change to a list that is reloading', () => {
    const state = run([
      { type: 'messages.loaded', chatId: 'cht_1', messages: [message('msg_1')] },
      { type: 'messages.loading', chatId: 'cht_1' },
      { type: 'message.updated', message: message('msg_1', { text: 'Edited' }) },
    ]);
    expect(state.messages.cht_1).toEqual({
      status: 'loading',
      data: [message('msg_1', { text: 'Edited' })],
    });
  });

  it('ignores changes to lists that are not loaded yet', () => {
    const before = run([{ type: 'messages.loading', chatId: 'cht_1' }]);
    const after = run(
      [
        { type: 'message.updated', message: message('msg_1') },
        { type: 'message.updated', message: message('msg_9', { chatId: 'cht_other' }) },
        { type: 'chat.updated', chat: chat('cht_1') },
      ],
      before,
    );
    expect(after).toBe(before);
  });

  it('updates a chat in place and puts a new chat on top', () => {
    const state = run([
      { type: 'chats.loaded', graduateId: 'grd_1', chats: [chat('cht_1'), chat('cht_2')] },
      { type: 'chat.updated', chat: chat('cht_2', { running: true, title: 'Close out Tuesday' }) },
      { type: 'chat.updated', chat: chat('cht_3') },
    ]);
    const chats = state.chats.grd_1?.data ?? [];
    expect(chats.map((c) => c.id)).toEqual(['cht_3', 'cht_1', 'cht_2']);
    expect(chats[2]).toMatchObject({ running: true, title: 'Close out Tuesday' });
  });

  it('keeps chats of one agent apart from another', () => {
    const state = run([
      { type: 'chats.loaded', graduateId: 'grd_1', chats: [chat('cht_1')] },
      { type: 'chats.loaded', graduateId: 'grd_2', chats: [] },
      { type: 'chat.updated', chat: chat('cht_9', { graduateId: 'grd_2' }) },
    ]);
    expect(state.chats.grd_1?.data?.map((c) => c.id)).toEqual(['cht_1']);
    expect(state.chats.grd_2?.data?.map((c) => c.id)).toEqual(['cht_9']);
  });

  it('forgets a removed agent with its chats and their messages', () => {
    const state = run([
      { type: 'chats.loaded', graduateId: 'grd_1', chats: [chat('cht_1')] },
      {
        type: 'chats.loaded',
        graduateId: 'grd_2',
        chats: [chat('cht_2', { graduateId: 'grd_2' })],
      },
      { type: 'messages.loaded', chatId: 'cht_1', messages: [message('msg_1')] },
      {
        type: 'messages.loaded',
        chatId: 'cht_2',
        messages: [message('msg_2', { chatId: 'cht_2' })],
      },
      { type: 'graduate.removed', graduateId: 'grd_1' },
    ]);
    expect(Object.keys(state.chats)).toEqual(['grd_2']);
    expect(Object.keys(state.messages)).toEqual(['cht_2']);
  });
});
