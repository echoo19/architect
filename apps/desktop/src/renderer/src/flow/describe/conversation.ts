import type { DraftTurn, Job } from '@architect/shared';

export interface UserEntry {
  kind: 'user';
  id: string;
  text: string;
  /** Full paths of the files sent with this message. */
  files: string[];
  /** Sent by picking one of the mentor's options; the picked option shows the answer. */
  viaOption?: true;
}

export interface MentorEntry {
  kind: 'mentor';
  id: string;
  message: string;
  options: string[];
  /** How many files the mentor read before answering; shown as a step line. */
  readFiles: number;
  /** The option the user picked, once they answered with one. */
  chosen?: string;
  draft?: Job;
}

export type Entry = UserEntry | MentorEntry;

/** A request to the mentor that is waiting or failed, kept so it can be sent again. */
export interface Request {
  text: string;
  files: string[];
  startedAt: number;
}

export interface Conversation {
  sessionId: string | null;
  entries: Entry[];
  waiting: Request | null;
  failure: { request: Request; message: string } | null;
  /** The draft that was saved and its job id, so reviewing it again keeps any edits made since. */
  saved: { entryId: string; jobId: string } | null;
}

export type ConversationAction =
  | { type: 'sent'; text: string; files: string[]; at: number; option?: string }
  | { type: 'retried'; at: number }
  | { type: 'replied'; turn: DraftTurn }
  | { type: 'failed'; message: string }
  | { type: 'saved'; entryId: string; jobId: string }
  | { type: 'reset' };

export const emptyConversation: Conversation = {
  sessionId: null,
  entries: [],
  waiting: null,
  failure: null,
  saved: null,
};

export function conversationReducer(state: Conversation, action: ConversationAction): Conversation {
  switch (action.type) {
    case 'sent': {
      const request = { text: action.text, files: action.files, startedAt: action.at };
      // A message that failed to send is replaced by the new one rather than left undelivered.
      const delivered = state.failure ? state.entries.slice(0, -1) : state.entries;
      const entries = action.option ? markChosen(delivered, action.option) : delivered;
      return {
        ...state,
        entries: [
          ...entries,
          {
            kind: 'user',
            id: `user-${entries.length}`,
            text: action.text,
            files: action.files,
            ...(action.option ? { viaOption: true as const } : {}),
          },
        ],
        waiting: request,
        failure: null,
      };
    }
    case 'retried':
      return state.failure
        ? { ...state, waiting: { ...state.failure.request, startedAt: action.at }, failure: null }
        : state;
    case 'replied': {
      const { turn } = action;
      const readFiles = state.sessionId === null ? (state.waiting?.files.length ?? 0) : 0;
      const entry: MentorEntry = {
        kind: 'mentor',
        id: `mentor-${state.entries.length}`,
        message: turn.message,
        options: turn.options,
        readFiles,
        ...(turn.draft ? { draft: turn.draft } : {}),
      };
      return {
        ...state,
        sessionId: turn.sessionId,
        entries: [...state.entries, entry],
        waiting: null,
        failure: null,
      };
    }
    case 'failed':
      return state.waiting
        ? { ...state, waiting: null, failure: { request: state.waiting, message: action.message } }
        : state;
    case 'saved':
      return { ...state, saved: { entryId: action.entryId, jobId: action.jobId } };
    case 'reset':
      return emptyConversation;
  }
}

/** Records which of the last mentor message's options the user answered with. */
function markChosen(entries: Entry[], option: string): Entry[] {
  const last = entries.at(-1);
  if (last?.kind !== 'mentor' || !last.options.includes(option)) return entries;
  return [...entries.slice(0, -1), { ...last, chosen: option }];
}

/** The mentor's latest message, if it is the last thing said. */
export function lastMentorEntry(state: Conversation): MentorEntry | null {
  const last = state.entries.at(-1);
  return last?.kind === 'mentor' ? last : null;
}
