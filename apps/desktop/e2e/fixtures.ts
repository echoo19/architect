import type { JobSummary, WorkspaceChat, WorkspaceMessage } from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { AT, detail, graduate, job, STORY, storyReport } from './story';

/*
 * Sample engine replies for screenshots of populated screens. They stand in for the engine
 * until it registers its own handlers, and tell the shared story (story.ts).
 */

export const SAMPLE = {
  graduateId: STORY.graduateId,
  chatId: 'cht_closeout',
  jobId: STORY.jobId,
  runId: STORY.runId,
  trainingRunId: 'run_dispatch',
};

const chats: WorkspaceChat[] = [
  {
    id: SAMPLE.chatId,
    graduateId: SAMPLE.graduateId,
    title: 'Close out Tuesday',
    createdAt: AT,
    updatedAt: AT,
    running: false,
    waiting: false,
  },
  {
    id: 'cht_overdue',
    graduateId: SAMPLE.graduateId,
    title: 'Overdue past 60 days',
    createdAt: AT,
    updatedAt: AT,
    running: false,
    waiting: true,
  },
  {
    id: 'cht_booking',
    graduateId: SAMPLE.graduateId,
    title: 'Book the Alder St leak',
    createdAt: AT,
    updatedAt: AT,
    running: true,
    waiting: false,
  },
];

const messages: WorkspaceMessage[] = [
  {
    id: 'msg_1',
    chatId: SAMPLE.chatId,
    role: 'user',
    createdAt: AT,
    text: 'Price the two jobs Dana finished today and tell me the totals.',
    steps: [],
    blocks: [],
    status: 'done',
  },
  {
    id: 'msg_2',
    chatId: SAMPLE.chatId,
    role: 'agent',
    createdAt: AT,
    text: 'Job J-4410 comes to $486.20 and job J-4412 to $1,284.50. The second ran after hours, so labor is billed at 1.5x, and the customer is a plan member, so 10% comes off before tax.',
    steps: [],
    blocks: [],
    status: 'done',
    workedMs: 3200,
  },
];

const jobs: JobSummary[] = [
  {
    id: 'job_dispatch',
    name: 'Dispatch board',
    createdAt: AT,
    taskCount: 120,
    latestRun: {
      id: SAMPLE.trainingRunId,
      status: 'running',
      phase: 'diagnosing',
      method: 'architect',
      devBaseline: { pass: 16, total: 40 },
      devCurrent: { pass: 23, total: 40 },
    },
  },
];

/** Channel → reply. Any channel not listed keeps the app's own behavior. */
export type EngineReplies = Record<string, unknown>;

/** A fresh install: the engine answers, and there is nothing yet. */
export const EMPTY_ENGINE: EngineReplies = {
  'graduates:list': [],
  'jobs:list': [],
};

export const SAMPLE_ENGINE: EngineReplies = {
  'graduates:list': [graduate],
  'workspace:listChats': chats,
  'workspace:messages': messages,
  'jobs:list': jobs,
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
