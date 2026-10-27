import type { ElectronApplication } from '@playwright/test';
import { CHATS, MESSAGES } from './fixtures-workspace';
import { detail, graduate, job, STORY, storyReport } from './story';

/*
 * Sample engine replies for screenshots of populated screens. They stand in for the engine
 * until it registers its own handlers, and tell the shared story (story.ts).
 */

export const SAMPLE = {
  graduateId: STORY.graduateId,
  chatId: CHATS.closeout.id,
  jobId: STORY.jobId,
  runId: STORY.runId,
};

/** Channel → reply. Any channel not listed keeps the app's own behavior. */
export type EngineReplies = Record<string, unknown>;

/** A fresh install: the engine answers, and there is nothing yet. */
export const EMPTY_ENGINE: EngineReplies = {
  'graduates:list': [],
  'jobs:list': [],
};

export const SAMPLE_ENGINE: EngineReplies = {
  'graduates:list': [graduate],
  'graduates:settings': { writeMode: 'ask' },
  'workspace:listChats': Object.values(CHATS),
  'workspace:messages': MESSAGES.filter((message) => message.chatId === CHATS.closeout.id),
  'jobs:list': [],
  'jobs:get': job,
  'runs:get': detail,
  'reports:get': storyReport,
};

/** Makes engine channels in the main process fail with the given message, as an outage would. */
export async function stubEngineFailure(
  app: ElectronApplication,
  failures: Record<string, string>,
): Promise<void> {
  await app.evaluate(({ ipcMain }, entries) => {
    for (const [channel, message] of Object.entries(entries)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ ok: false, error: { message } }));
    }
  }, failures);
}

/** Answers engine channels in the main process with fixed replies. */
export async function stubEngine(app: ElectronApplication, replies: EngineReplies): Promise<void> {
  await app.evaluate(({ ipcMain }, entries) => {
    for (const [channel, value] of Object.entries(entries)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ ok: true, value }));
    }
  }, replies);
}
