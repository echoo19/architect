import type {
  Intervention,
  JobRun,
  JobSummary,
  Round,
  Run,
  RunDetail,
  RunEvent,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import {
  LLAMA_SERVER_READY,
  LOCAL_WITH_GLIMMER,
  NOTHING_LOCAL,
  OLLAMA_READY,
  type EngineReplies,
} from './fixtures';
import { FLOW_ENGINE } from './fixtures-flow';
import { at, AT, detail, job, makeRun, rounds, STORY } from './story';

/*
 * Stand-in engine replies for the ways a run can be left and come back to: the sidebar's rows, a
 * run paused on something that needs putting right, and a run waiting for the person's answer.
 * They tell the shared story (story.ts), so the numbers agree with the other captures.
 */

function summary(
  number: number,
  name: string,
  latestRun: Partial<JobRun> & Pick<JobRun, 'status' | 'phase'>,
): JobSummary {
  return {
    id: `job_${number}`,
    name,
    createdAt: AT,
    taskCount: 170,
    latestRun: {
      id: `run_${number}`,
      method: 'architect',
      devCurrent: null,
      devBaseline: null,
      ...latestRun,
    },
  };
}

/** What the sidebar lists: one job for each kind of row, and one whose agent needs none. */
export const SIDEBAR_JOBS: JobSummary[] = [
  summary(1, 'Service desk', { status: 'running', phase: 'attempting' }),
  summary(2, 'Returns desk', { status: 'paused', phase: 'clarifying' }),
  summary(3, 'Parts counter', { status: 'paused', phase: 'diagnosing' }),
  // The results of this one are the story's own, so opening its row shows a real page.
  {
    ...summary(4, 'Clinic intake', { status: 'finished', phase: 'done', accepted: false }),
    latestRun: {
      id: STORY.runId,
      method: 'architect',
      status: 'finished',
      phase: 'done',
      devCurrent: null,
      devBaseline: null,
      accepted: false,
    },
  },
  summary(5, 'Field notes', { status: 'stopped', phase: 'done' }),
  summary(6, 'Night audit', { status: 'failed', phase: 'done' }),
  summary(7, 'Front desk', { status: 'finished', phase: 'done', accepted: true }),
];

/** The same jobs once the person has taken the agent whose results were waiting. */
export const SIDEBAR_JOBS_AFTER_ACCEPTING: JobSummary[] = SIDEBAR_JOBS.map((item) =>
  item.latestRun?.accepted === false
    ? { ...item, latestRun: { ...item.latestRun, accepted: true } }
    : item,
);

/**
 * What the engine answers about the computer: a Settings that opens here never reaches a provider
 * or the llama-server of the computer running the tests.
 */
const THIS_COMPUTER: EngineReplies = {
  'connections:listModels': [],
  'connections:llamaServer': LLAMA_SERVER_READY,
};

/** What the engine answers while the person is on the home screen, with nothing running. */
export const HOME_ENGINE: EngineReplies = {
  ...FLOW_ENGINE,
  ...THIS_COMPUTER,
  'jobs:list': SIDEBAR_JOBS,
  'graduates:settings': { writeMode: 'ask' },
  'secrets:status': { meta: true, openrouter: true },
  'connections:detectLocal': LOCAL_WITH_GLIMMER,
};

/** The run as it is paused, with what the engine recorded when it paused it. */
export const KEY_MISSING = 'No key is saved for "meta". Add it in Settings and try again.';

function pausedRun(overrides: Partial<Run>): Run {
  return makeRun({
    status: 'paused',
    phase: 'diagnosing',
    updatedAt: at(120),
    error: KEY_MISSING,
    ...overrides,
  });
}

/** The training screen of a run paused on an error, opened later, with nothing watched live. */
export function pausedEngine(options: {
  detail?: Partial<RunDetail>;
  keys?: Record<string, boolean>;
  local?: EngineReplies['connections:detectLocal'];
  error?: string;
}): EngineReplies {
  return {
    ...FLOW_ENGINE,
    ...THIS_COMPUTER,
    'runs:get': {
      ...detail,
      run: pausedRun(options.error === undefined ? {} : { error: options.error }),
      ...options.detail,
    } satisfies RunDetail,
    'secrets:status': options.keys ?? { meta: false, openrouter: true },
    'connections:detectLocal': options.local ?? LOCAL_WITH_GLIMMER,
  };
}

export { NOTHING_LOCAL, OLLAMA_READY, LOCAL_WITH_GLIMMER };

/** This computer's student, for a run that practices here. */
export const LOCAL_JOB = job;

/** The question Spark asks in round 4. */
export const QUESTION = 'Should an invoice due today count as overdue?';
export const ANSWER = 'No, only from the next day.';

function question(answer?: { text: string; changesCriteria: boolean }): Intervention {
  return {
    id: 'itv_question',
    runId: STORY.runId,
    round: 4,
    type: 'clarification',
    title: 'Ask about due dates',
    hypothesis: 'The policy does not say whether an invoice due today is already overdue.',
    findings: [],
    setAside: [],
    edits: [],
    workedExamples: [],
    practicePerFinding: 0,
    question: QUESTION,
    ...(answer === undefined ? {} : { answer: { ...answer, at: at(122) } }),
    predicted: { devDeltaMin: 0, devDeltaMax: 0, rationale: 'It asks, so it changes nothing.' },
    estimatedCost: { mentorUsd: 0, computeUsd: 0, minutes: 0 },
    verificationPlan: '',
    parent: { harnessVersion: 4, adapter: null },
    status: 'accepted',
    createdAt: at(118),
  };
}

/** Round 4 as it asks: practiced, diagnosed, and waiting for the person. */
const asking: Round = {
  ...(rounds[3] as Round),
  title: 'Ask about due dates',
  diagnosis:
    'Two overdue failures turn on whether an invoice due today is already overdue. The policy ' +
    'does not say.',
  status: 'clarifying',
  files: [],
  candidateVersion: undefined,
  devBefore: undefined,
  devAfter: undefined,
  firstMeasurement: undefined,
};

/** The training screen of a run waiting for an answer to Spark's question. */
export function askingEngine(answered?: { text: string; changesCriteria: boolean }): EngineReplies {
  const waiting = answered === undefined;
  const settled: Round = {
    ...asking,
    status: 'decided',
    decisionReason: `Answered: ${answered?.text ?? ''}`,
    endedAt: at(123),
  };
  return {
    ...FLOW_ENGINE,
    'runs:get': {
      ...detail,
      run: makeRun({
        status: waiting ? 'paused' : 'running',
        phase: waiting ? 'clarifying' : 'attempting',
        updatedAt: at(waiting ? 120 : 123),
      }),
      rounds: [...rounds.slice(0, 3), waiting ? asking : settled],
    } satisfies RunDetail,
    'mentoring:interventions': [question(answered)],
  };
}

/** A run stopped while the question was still open: nothing can take an answer any more. */
export function endedAskingEngine(): EngineReplies {
  return {
    ...askingEngine(),
    'runs:get': {
      ...detail,
      run: makeRun({
        status: 'stopped',
        phase: 'done',
        stopReason: 'user',
        endedAt: at(121),
        updatedAt: at(121),
      }),
      rounds: [...rounds.slice(0, 3), asking],
    } satisfies RunDetail,
  };
}

/** What the engine sends once it has taken the answer up and the run goes on. */
export function answerTakenUp(answer: { text: string; changesCriteria: boolean }): RunEvent[] {
  const base = { runId: STORY.runId, at: at(123) };
  const settled: Round = {
    ...asking,
    status: 'decided',
    decisionReason: answer.changesCriteria
      ? 'The answer changes what counts as success, so the run stopped for a new job contract.'
      : `Answered: ${answer.text}`,
    endedAt: at(123),
  };
  const run = answer.changesCriteria
    ? makeRun({
        status: 'stopped',
        phase: 'done',
        stopReason: 'contract',
        endedAt: at(123),
        updatedAt: at(123),
      })
    : makeRun({ status: 'running', phase: 'attempting', updatedAt: at(123) });
  return [
    { ...base, type: 'round.updated', round: settled },
    { ...base, type: 'run.updated', run },
    { ...base, type: 'mentoring.updated', record: 'intervention', id: 'itv_question', round: 4 },
  ];
}

/** Lets a test change what a channel answers while the app is open. */
export async function stubSwitch(
  app: ElectronApplication,
  channel: string,
  replies: Record<string, unknown>,
  initial: string,
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, replies, initial }) => {
      const state = globalThis as typeof globalThis & { switches?: Record<string, string> };
      state.switches = { ...state.switches, [channel]: initial };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({
        ok: true,
        value: replies[state.switches?.[channel] ?? initial],
      }));
    },
    { channel, replies, initial },
  );
}

export async function flipSwitch(
  app: ElectronApplication,
  channel: string,
  to: string,
): Promise<void> {
  await app.evaluate(
    (_electron, { channel, to }) => {
      const state = globalThis as typeof globalThis & { switches?: Record<string, string> };
      state.switches = { ...state.switches, [channel]: to };
    },
    { channel, to },
  );
}
