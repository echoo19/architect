/** Unsent text per chat, kept while the app runs so switching chats doesn't lose it. */
const drafts = new Map<string, string>();

export function draftFor(chatId: string): string {
  return drafts.get(chatId) ?? '';
}

export function keepDraft(chatId: string, text: string): void {
  if (text) drafts.set(chatId, text);
  else drafts.delete(chatId);
}
