import {
  glimmerBuild,
  LMSTUDIO_BASE_URL,
  OLLAMA_BASE_URL,
  type GpuInfo,
  type LlamaServerStatus,
  type LocalRuntimes,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { installation } from './fixtures-versions';
import { CHATS, MESSAGES } from './fixtures-workspace';
import {
  detail,
  graduate,
  job,
  STORY,
  storyCapabilities,
  storyProgress,
  storyReport,
} from './story';

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

/** No model runtime on this computer and no GPU found. */
export const NOTHING_LOCAL: LocalRuntimes = {
  ollama: { running: false, baseUrl: OLLAMA_BASE_URL, models: [] },
  lmstudio: { running: false, baseUrl: LMSTUDIO_BASE_URL, models: [] },
  gpu: null,
};

/** Ollama answering with nothing downloaded yet: what a new install sees. */
export const OLLAMA_READY: LocalRuntimes = {
  ...NOTHING_LOCAL,
  ollama: { running: true, version: '0.12.6', baseUrl: OLLAMA_BASE_URL, models: [] },
};

/** A 12 GB card, which holds Glimmer's 2-bit build but not its 4-bit one. */
export const GPU_12GB: GpuInfo = {
  name: 'NVIDIA GeForce RTX 4070',
  memoryBytes: 12 * 1024 ** 3,
  shared: false,
};

/** Ollama with Glimmer's GPU-sized build downloaded, on that card. */
export const LOCAL_WITH_GLIMMER: LocalRuntimes = {
  ...OLLAMA_READY,
  ollama: {
    ...OLLAMA_READY.ollama,
    models: [{ id: glimmerBuild('glimmer-gpu').model, sizeBytes: 10_746_373_364 }],
  },
  gpu: GPU_12GB,
};

/**
 * llama-server found on PATH, new enough for Glimmer. Every spec that shows Settings › Models
 * answers with this, so the real llama-server of the computer running the tests never runs.
 */
export const LLAMA_SERVER_READY: LlamaServerStatus = {
  source: 'path',
  path: '/usr/local/bin/llama-server',
  build: 10472,
  ready: true,
  minimumBuild: 10358,
};

/** A fresh install: the engine answers, and there is nothing yet. */
export const EMPTY_ENGINE: EngineReplies = {
  'graduates:list': [],
  'jobs:list': [],
  'connections:detectLocal': NOTHING_LOCAL,
  'connections:llamaServer': LLAMA_SERVER_READY,
};

/**
 * The story's run as the evidence screens read it: no lessons or experiments (it ran before
 * they were kept), its capabilities from its final test, and its agent ready on this computer.
 */
export const STORY_EVIDENCE: EngineReplies = {
  'mentoring:lessons': [],
  'mentoring:interventions': [],
  'mentoring:experiments': [],
  'mentoring:progress': storyProgress,
  'mentoring:categories': [],
  'mentoring:capabilities': storyCapabilities,
  'mentoring:references': [],
  'runs:runtimeMeasurements': [],
  'reports:comparisons': null,
  'graduates:installation': installation(STORY.graduateId),
};

export const SAMPLE_ENGINE: EngineReplies = {
  'connections:detectLocal': LOCAL_WITH_GLIMMER,
  'connections:llamaServer': LLAMA_SERVER_READY,
  'graduates:list': [graduate],
  'graduates:settings': { writeMode: 'ask' },
  'workspace:listChats': Object.values(CHATS),
  'workspace:messages': MESSAGES.filter((message) => message.chatId === CHATS.closeout.id),
  'jobs:list': [],
  'jobs:get': job,
  'runs:get': detail,
  'reports:get': storyReport,
  ...STORY_EVIDENCE,
};

/** A failure the way the main process sends one: its message, and the code a screen words it by. */
export interface StubFailure {
  message: string;
  code?: string;
}

/** What every call says while the engine process restarts after stopping mid-call. */
export const ENGINE_RESTARTING: StubFailure = {
  message:
    'The engine stopped while it was working on this. It is restarting; try again in a moment.',
  code: 'process_restarting',
};

/**
 * Makes engine channels in the main process fail as an outage would: with a message alone, or
 * with the message and code the main process sends.
 */
export async function stubEngineFailure(
  app: ElectronApplication,
  failures: Record<string, string | StubFailure>,
): Promise<void> {
  await app.evaluate(({ ipcMain }, entries) => {
    for (const [channel, failure] of Object.entries(entries)) {
      const error = typeof failure === 'string' ? { message: failure } : failure;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ ok: false, error }));
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
