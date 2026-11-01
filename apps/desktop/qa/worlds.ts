import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElectronApplication } from '@playwright/test';
import { DataPaths } from '@architect/engine';
import { FAKE_HUB_TOKEN, openEngineStore, startFakeHub } from '@architect/engine/testing';
import {
  GLIMMER_TRAINING_BASE,
  type AppSettings,
  type MentorConfig,
  type RunEvent,
  type StudentEndpoint,
} from '@architect/shared';
import { launchApp, type LaunchedApp } from '../e2e/app';
import { LLAMA_SERVER_READY, STORY_EVIDENCE, stubEngine } from '../e2e/fixtures';
import { ACADEMY_DESK_CERTIFICATE } from '../e2e/fixtures-certify';
import { GLIMMER_STAND_IN_CONFIG } from '../e2e/fixtures-compute';
import { ASK, draftReply, ROUND_DRAFT } from '../e2e/fixtures-drafting';
import { installExperimentsFake } from '../e2e/fixtures-experiments';
import { FIELD_REPORTS, stubFields } from '../e2e/fixtures-fields';
import {
  COPY_ANSWERS,
  finalTest,
  finished,
  FLOW,
  FLOW_LOCAL,
  roundFourKept,
  startedRun,
  stubByKey,
} from '../e2e/fixtures-flow';
import { DETAILS, LAB, LAB_AGENTS, LAB_EXPERIMENTS } from '../e2e/fixtures-lab';
import { installModelsFake } from '../e2e/fixtures-models';
import { SWEEP_EXPERIMENT, sweepComparison } from '../e2e/fixtures-science-experiment';
import {
  installTeamsFake,
  TEAM,
  TEAM_AGENTS,
  TEAM_RECORDS,
  teamWorld,
} from '../e2e/fixtures-teams';
import { installation } from '../e2e/fixtures-versions';
import { STUDENT_MODEL } from '../e2e/fixtures-workspace';
import {
  startFakeOllama,
  startScriptedMentor,
  type MentorChatBody,
  type OllamaTurn,
} from '../e2e/models';
import { RECORDED_COMPARISON_ENV, recordedComparisonReport } from '../e2e/recorded';
import { shop } from '../e2e/shop';
import { detail, GLIMMER_BYTES, reports, roundDiff, trace } from '../e2e/story';

/*
 * The worlds a tester walks through: the built app on a throwaway profile, the e2e suite's
 * stand-ins on 127.0.0.1 and its IPC stubs. No remote model, no Hugging Face, no GPU and none of
 * this computer's Ollama or llama-server is ever reached.
 */

export const WORLDS = ['first-run', 'personal', 'lab'] as const;
export type WorldName = (typeof WORLDS)[number];

export interface World {
  launched: LaunchedApp;
  /** Lines worth telling the tester, such as where the files to attach are. */
  notes: string[];
  /** Closes the app, deleting its profile, and every stand-in the world started. */
  close(): Promise<void>;
}

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Every provider key the app could read from its environment, blanked. */
const NO_KEYS: Record<string, string> = Object.fromEntries(
  [
    'META_API_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'TOGETHER_API_KEY',
    'DEEPINFRA_API_KEY',
    'FIREWORKS_API_KEY',
    'BASETEN_API_KEY',
    'MODAL_PROXY_TOKEN',
    'HF_TOKEN',
    'HUGGING_FACE_HUB_TOKEN',
    'ARCHITECT_KEYS_FROM_ENV',
  ].map((name) => [name, '']),
);

/**
 * The scripted teacher: a job's first drafting turn asks one question, any later one drafts the
 * shop's job, and every other request (a connection test, a training round) gets a harness draft.
 */
function teacher(request: MentorChatBody): unknown {
  if (request.response_format?.json_schema?.name !== 'job_draft') return ROUND_DRAFT;
  const turns = request.messages.filter((message) => message.role === 'user').length;
  return turns <= 1 ? ASK : draftReply([]);
}

interface StandIns {
  defaultMentor: MentorConfig;
  defaultStudent: StudentEndpoint;
  /** The profile's settings with them as its default teacher and model. */
  settings: Partial<AppSettings>;
  close(): Promise<void>;
}

/**
 * A fake Ollama holding Glimmer, which answers every chat with `chat`, and the scripted teacher,
 * set up as the profile's default model and teacher.
 */
async function standIns(chat: readonly OllamaTurn[]): Promise<StandIns> {
  const ollama = await startFakeOllama(chat, {
    models: [{ name: STUDENT_MODEL, sizeBytes: GLIMMER_BYTES, digest: `sha256:${'a'.repeat(64)}` }],
  });
  const mentor = await startScriptedMentor(teacher);
  const defaultStudent: StudentEndpoint = {
    runtime: 'ollama',
    baseUrl: ollama.baseUrl,
    model: STUDENT_MODEL,
    contextLength: 16_384,
  };
  const defaultMentor: MentorConfig = {
    kind: 'model',
    provider: 'lmstudio',
    label: 'Muse Spark 1.3',
    baseUrl: mentor.baseUrl,
    model: 'scripted-spark',
    reasoningEffort: 'medium',
  };
  return {
    defaultMentor,
    defaultStudent,
    settings: { comparisonMode: false, defaultMentor, defaultStudent },
    close: async () => {
      await ollama.close();
      await mentor.close();
    },
  };
}

/**
 * What this computer holds, as a stand-in: Glimmer downloaded in the fake Ollama and a 12 GB card,
 * so neither nvidia-smi nor this computer's runtimes are asked. llama-server is found, never run.
 */
async function stubComputer(app: ElectronApplication, ollamaUrl: string): Promise<void> {
  await stubEngine(app, {
    'connections:detectLocal': {
      ...FLOW_LOCAL,
      ollama: { ...FLOW_LOCAL.ollama, baseUrl: ollamaUrl },
    },
    'connections:llamaServer': LLAMA_SERVER_READY,
  });
}

/**
 * Nothing the app asks of the system pops up: a file dialog nobody answered with `file` is
 * cancelled, a message box takes its cancel button, and links and folders stay closed. Each is
 * kept in `globalThis.qaSystem` for the errors endpoint.
 */
async function quietSystem(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog, shell }) => {
    const asked: string[] = [];
    Object.assign(globalThis, { qaSystem: asked });
    dialog.showOpenDialog = async () => {
      asked.push('A file dialog opened with no `file` act before it, and was cancelled.');
      return { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => {
      asked.push('A save dialog opened with no `file` act before it, and was cancelled.');
      return { canceled: true, filePath: '' };
    };
    dialog.showMessageBox = async (...args: unknown[]) => {
      const options = args.find(
        (arg): arg is { message?: string; cancelId?: number } =>
          typeof arg === 'object' && arg !== null && 'message' in arg,
      );
      asked.push(`A message box asked "${options?.message ?? ''}" and was cancelled.`);
      return { response: options?.cancelId ?? 0, checkboxChecked: false };
    };
    dialog.showErrorBox = (title: string, content: string) => {
      asked.push(`An error box said "${title}: ${content}".`);
    };
    shell.openExternal = async (url: string) => {
      asked.push(`A link to ${url} would have opened in the browser.`);
    };
    shell.openPath = async (path: string) => {
      asked.push(`${path} would have opened.`);
      return '';
    };
    shell.showItemInFolder = (path: string) => {
      asked.push(`${path} would have been shown in its folder.`);
    };
  });
}

/** Runs one of the e2e recorders into `target`, unless an earlier start left its output there. */
function record(script: string, target: string, done: string): void {
  if (existsSync(join(target, done))) return;
  execFileSync(process.execPath, ['--import', 'tsx', script, target], {
    cwd: REPO,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** Launches the app hidden on a throwaway profile, quiets the system and settles its size. */
async function launch(options: Parameters<typeof launchApp>[0]): Promise<LaunchedApp> {
  const launched = await launchApp({ ...options, env: { ...NO_KEYS, ...options?.env } });
  // tsx keeps function names with a `__name` helper, which the functions sent to the app's main
  // process and window bring along; there it does nothing.
  await launched.app.evaluate('globalThis.__name = (fn) => fn');
  await launched.page.addInitScript('globalThis.__name = (fn) => fn');
  await launched.page.evaluate('globalThis.__name = (fn) => fn');
  await quietSystem(launched.app);
  return launched;
}

async function reload(launched: LaunchedApp): Promise<void> {
  await launched.page.reload();
  await launched.page.waitForLoadState('domcontentloaded');
}

/**
 * A brand-new profile, not yet set up, in the personal edition. Glimmer is downloaded in the fake
 * Ollama, which also answers as the student once training starts; the scripted teacher asks and
 * drafts; the shop's records wait in `<out>/files` to be attached.
 */
async function firstRun(out: string): Promise<World> {
  const files = join(out, 'files');
  await mkdir(files, { recursive: true });
  const records = shop();
  await writeFile(join(files, 'customers.csv'), records.customersCsv);
  await writeFile(join(files, 'orders.csv'), records.ordersCsv);
  await writeFile(join(files, 'policy.md'), '# Shop policy\n\nReturns are accepted for 30 days.\n');
  const models = await standIns([{ text: 'ANSWER: {}' }]);
  const launched = await launch({
    settings: { ...models.settings, onboarded: false, edition: 'personal' },
  });
  await stubComputer(launched.app, models.defaultStudent.baseUrl);
  await reload(launched);
  return {
    launched,
    notes: [
      `Files to attach: ${['customers.csv', 'orders.csv', 'policy.md'].map((name) => join(files, name)).join(', ')}`,
    ],
    close: async () => {
      await launched.close();
      await models.close();
    },
  };
}

/** What the returns desk's agent says to anything, after reading the shop's policy once. */
const RETURNS_DESK_CHAT: readonly OllamaTurn[] = [
  { toolCall: { name: 'read', arguments: { path: 'data/policy.md' } } },
  {
    text:
      'Approved. It came back unopened inside the return window, so the full price goes back ' +
      'to the card it was paid with.',
  },
];

/**
 * Set up, in the personal edition, on the recorded run's real data: the returns desk's job, its
 * run and evidence, and its agent in the workspace. The agent and the job's student run on the
 * fake Ollama, and the job's teacher is the scripted one, so training it again stays here.
 */
async function personal(out: string): Promise<World> {
  const recorded = join(out, 'recorded');
  record(join(REPO, 'examples/gear-returns/scripts/record-run.ts'), recorded, 'recorded-run.json');
  const summary = JSON.parse(await readFile(join(recorded, 'recorded-run.json'), 'utf8')) as {
    jobId: string;
    graduateId: string | null;
  };
  const models = await standIns(RETURNS_DESK_CHAT);
  const student = models.defaultStudent;
  const launched = await launch({
    data: recorded,
    settings: { ...models.settings, onboarded: true, edition: 'personal' },
    // The recording installed its agent on Ollama's usual address; here it is the fake one.
    prepare: async (userData) => {
      if (summary.graduateId === null) return;
      const store = openEngineStore(new DataPaths(userData).database);
      try {
        const installation = store.installations.get(summary.graduateId);
        if (installation) {
          store.installations.put({
            ...installation,
            model: { ...installation.model, baseUrl: student.baseUrl },
          });
        }
      } finally {
        store.close();
      }
    },
  });
  await stubComputer(launched.app, student.baseUrl);
  const { page } = launched;
  await page.evaluate(
    async ({ jobId, mentor, local }) => {
      const job = await window.architect.jobs.get(jobId);
      await window.architect.jobs.save({ ...job, mentor, student: { ...job.student, local } });
    },
    { jobId: summary.jobId, mentor: models.defaultMentor, local: student },
  );
  await reload(launched);
  return {
    launched,
    notes: [`Recorded run: ${recorded}`],
    close: async () => {
      await launched.close();
      await models.close();
    },
  };
}

/**
 * Start training plays the story's run in the Lab: round 4 kept, the final test, then the agent.
 * Whichever job it is started from, the run is the service desk's.
 */
async function liveTraining(app: ElectronApplication): Promise<void> {
  const steps: [number, RunEvent[]][] = [
    [3_000, roundFourKept()],
    [8_000, finalTest(20)],
    [12_000, finalTest(40)],
    [16_000, finalTest(60)],
    [20_000, finished()],
  ];
  await stubByKey(app, 'runs:get', { ...DETAILS, [FLOW.runId]: detail });
  // What the run's screens read of its rounds and evidence: the story's, for every run.
  const { 'graduates:installation': _installation, ...evidence } = STORY_EVIDENCE;
  await stubEngine(app, { ...evidence, 'runs:trace': trace, 'runs:roundDiff': roundDiff });
  await app.evaluate(
    ({ BrowserWindow, ipcMain }, { run, json }) => {
      const timeline = JSON.parse(json) as [number, unknown[]][];
      ipcMain.removeHandler('runs:start');
      ipcMain.handle('runs:start', () => {
        for (const [ms, events] of timeline) {
          setTimeout(() => {
            for (const window of BrowserWindow.getAllWindows()) {
              for (const event of events) window.webContents.send('runs:onEvent', event);
            }
          }, ms);
        }
        return { ok: true, value: run };
      });
    },
    { run: startedRun, json: JSON.stringify(steps) },
  );
}

/**
 * An experiment started or resumed in the Lab finishes 45 seconds later, its report the recorded
 * comparison's, as every experiment running then does.
 */
async function liveExperiments(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents;
      const send = contents.send.bind(contents);
      contents.send = (channel: string, ...args: unknown[]) => {
        const event = args[0] as { experiment?: { status?: string } } | undefined;
        if (channel === 'experiments:onEvent' && event?.experiment?.status === 'running') {
          setTimeout(() => {
            (
              globalThis as unknown as { fakeExperiments: { finish: () => void } }
            ).fakeExperiments.finish();
          }, 45_000);
        }
        send(channel, ...args);
      };
    }
  });
}

/**
 * The Lab edition as the Lab's specs see it: fields with their organizations (the academies, the
 * science desks), experiments with the recorded comparison, the models registry, teams, a
 * certificate on Academy desk's report and its fine-tuning data, and Compute reading Glimmer's
 * stand-in config from a fake Hub.
 */
async function lab(out: string): Promise<World> {
  const comparison = join(out, 'comparison');
  record(join(REPO, 'packages/engine/scripts/record-dry-comparison.ts'), comparison, 'report.json');
  process.env[RECORDED_COMPARISON_ENV] = comparison;
  const report = await recordedComparisonReport();
  const hub = await startFakeHub();
  hub.repos.set(GLIMMER_TRAINING_BASE.repo, { private: false, commits: [] });
  hub.commit(GLIMMER_TRAINING_BASE.repo, {
    'config.json': Buffer.from(JSON.stringify(GLIMMER_STAND_IN_CONFIG)),
  });
  const models = await standIns([{ text: 'ANSWER: {}' }]);
  const launched = await launch({
    env: { HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN },
    settings: { ...models.settings, onboarded: true, edition: 'lab' },
  });
  const { app } = launched;
  // Later layers answer the channels they share with earlier ones.
  await installTeamsFake(app, teamWorld({ teams: [TEAM] }));
  await stubFields(app);
  await installModelsFake(app, TEAM_RECORDS);
  // Every agent's install checks on this computer, the team's from their own folders.
  await stubByKey(app, 'graduates:installation', {
    ...Object.fromEntries(
      LAB_AGENTS.map((agent) => [
        agent.id,
        installation(agent.id, { version: agent.activeVersion ?? 1 }),
      ]),
    ),
    ...TEAM_RECORDS.installations,
  });
  await stubByKey(app, 'reports:get', {
    ...FIELD_REPORTS,
    [FLOW.runId]: reports[FLOW.runId],
    [LAB.academyDeskRun]: {
      ...FIELD_REPORTS[LAB.academyDeskRun],
      certificate: ACADEMY_DESK_CERTIFICATE,
    },
  });
  await installExperimentsFake(app, sweepComparison(report), undefined, [
    // Sweep desk's finished experiment is the one with its paper.
    ...LAB_EXPERIMENTS.filter((item) => item.input.name !== SWEEP_EXPERIMENT.input.name),
    SWEEP_EXPERIMENT,
  ]);
  await stubComputer(app, models.defaultStudent.baseUrl);
  await stubEngine(app, {
    // The team's agents beside the Lab's, so the team shows who leads it.
    'graduates:list': [...LAB_AGENTS, TEAM_AGENTS.lead, TEAM_AGENTS.teammate],
    // The Lab's jobs teach with Spark and train online; both say they are connected, and no
    // key exists, so nothing is ever sent.
    'secrets:status': { meta: true, openrouter: true },
    'connections:testMentor': { ok: true, latencyMs: 640, detail: 'muse-spark-1.3' },
    'connections:testStudent': COPY_ANSWERS,
  });
  await liveTraining(app);
  await liveExperiments(app);
  await reload(launched);
  return {
    launched,
    notes: [`Recorded comparison: ${comparison}`],
    close: async () => {
      await launched.close();
      await models.close();
      await hub.close();
    },
  };
}

export function startWorld(name: WorldName, out: string): Promise<World> {
  switch (name) {
    case 'first-run':
      return firstRun(out);
    case 'personal':
      return personal(out);
    case 'lab':
      return lab(out);
  }
}
