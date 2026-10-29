import { create } from 'zustand';
import { flowApi } from '../../api/client';
import { toError } from '../../api/query';
import {
  conversationReducer,
  emptyConversation,
  type Conversation,
  type ConversationAction,
} from './conversation';

interface DraftStore {
  conversation: Conversation;
  /** What's typed into the Describe box before the first send. */
  text: string;
  files: string[];
  setText: (text: string) => void;
  setFiles: (files: string[]) => void;
}

/**
 * The job-drafting conversation lives outside the screen, so "Back" from the Define screen
 * returns to it as it was.
 */
export const useDraftStore = create<DraftStore>()((set) => ({
  conversation: emptyConversation,
  text: '',
  files: [],
  setText: (text) => set({ text }),
  setFiles: (files) => set({ files }),
}));

// Bumped on every reset, so a reply to an abandoned conversation is dropped when it lands.
let generation = 0;

function dispatch(action: ConversationAction): void {
  useDraftStore.setState((state) => ({
    conversation: conversationReducer(state.conversation, action),
  }));
}

async function ask(text: string, files: string[]): Promise<void> {
  const asked = generation;
  const { sessionId } = useDraftStore.getState().conversation;
  try {
    const turn = sessionId
      ? await flowApi.draftReply(sessionId, text)
      : await flowApi.draftStart(text, files);
    if (asked === generation) dispatch({ type: 'replied', turn });
  } catch (error) {
    if (asked === generation) dispatch({ type: 'failed', error: toError(error) });
  }
}

/** Sends the description (with its files) or a reply, optionally one of the offered options. */
export function sendToMentor(text: string, files: string[], option?: string): void {
  dispatch({ type: 'sent', text, files, at: Date.now(), ...(option ? { option } : {}) });
  void ask(text, files);
}

export function retryLastMessage(): void {
  const { failure } = useDraftStore.getState().conversation;
  if (!failure) return;
  dispatch({ type: 'retried', at: Date.now() });
  void ask(failure.request.text, failure.request.files);
}

export function markDraftSaved(entryId: string, jobId: string): void {
  dispatch({ type: 'saved', entryId, jobId });
}

/** Starts over, optionally putting the first message back in the Describe box to edit. */
export function resetDraft(options: { keepFirstMessage?: boolean } = {}): void {
  generation += 1;
  const first = useDraftStore.getState().conversation.entries[0];
  const restore = options.keepFirstMessage && first?.kind === 'user';
  useDraftStore.setState({
    conversation: emptyConversation,
    text: restore ? first.text : '',
    files: restore ? first.files : [],
  });
}
