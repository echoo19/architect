import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElectronApplication } from '@playwright/test';
import { DataPaths } from '@architect/engine';
import { FAKE_HUB_TOKEN, openEngineStore, startFakeHub } from '@architect/engine/testing';
import {
  GLIMMER_TRAINING_BASE,
  glimmerBuild,
  type AppSettings,
  type JobSummary,
  type MentorConfig,
  type RunDetail,
  type RunEvent,
  type StudentEndpoint,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import { launchApp, type LaunchedApp } from '../e2e/app';
import { LLAMA_SERVER_READY, STORY_EVIDENCE, stubEngine } from '../e2e/fixtures';
import {
  ACTIVITY_PLANS,
  activityOf,
  agentHistory,
  type AgentActivity,
} from '../e2e/fixtures-activity';
import { ACADEMY_DESK_CERTIFICATE } from '../e2e/fixtures-certify';
import { GLIMMER_STAND_IN_CONFIG } from '../e2e/fixtures-compute';
import { ACADEMY_DESK_COUNTEREXAMPLES } from '../e2e/fixtures-counterexamples';
import { ASK, draftReply, ROUND_DRAFT } from '../e2e/fixtures-drafting';
import { installExperimentsFake } from '../e2e/fixtures-experiments';
import {
  FIELD_CAPABILITIES,
  FIELD_CHAT,
  FIELD_MEASUREMENT,
  FIELD_MESSAGES,
  HOSTED_RETEST_REPORT,
} from '../e2e/fixtures-field';
import {
  FIELD_REPORTS,
  FIELD_VIEWS,
  REPORT_TARGETS,
  RUNS,
  stubFields,
  TASK_PLANS,
} from '../e2e/fixtures-fields';
import {
  COPY_ANSWERS,
  finalTest,
  finished,
  FLOW,
  FLOW_LOCAL,
  laterRounds,
  roundFourKept,
  startedRun,
  stubByKey,
  taskPlan,
} from '../e2e/fixtures-flow';
import {
  ACADEMY_DESK_AGENT,
  ACADEMY_DESK_ID,
  DETAILS,
  JOBS,
  LAB,
  LAB_AGENTS,
  LAB_EXPERIMENTS,
  LAB_JOBS,
} from '../e2e/fixtures-lab';
import { installModelsFake } from '../e2e/fixtures-models';
import { exampleField } from '../e2e/fixtures-science';
import { SWEEP_EXPERIMENT, sweepComparison } from '../e2e/fixtures-science-experiment';
import {
  installTeamsFake,
  TEAM,
  TEAM_AGENTS,
  TEAM_CHAT,
  TEAM_MESSAGES,
  TEAM_RECORDS,
  teamWorld,
} from '../e2e/fixtures-teams';
import { AGENT_WITH_VERSIONS, installation } from '../e2e/fixtures-versions';
import { CHATS, MESSAGES, STUDENT_MODEL } from '../e2e/fixtures-workspace';
import {
  startFakeOllama,
  startScriptedMentor,
  type MentorChatBody,
  type OllamaTurn,
} from '../e2e/models';
import { RECORDED_COMPARISON_ENV, recordedComparisonReport } from '../e2e/recorded';
import { shop } from '../e2e/shop';
import {
  ACADEMY_EARLIER_RUN,
  ACADEMY_MINI_RUN,
  ACADEMY_ROUND_DIFF,
  ACADEMY_RUN,
  academyTrace,
  detail,
  GLIMMER_BYTES,
  recentAttempts,
  reports,
  roundDiff,
  storyCapabilities,
  storyProgress,
  trace,
} from '../e2e/story';

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

/** What a Glimmer build weighs on disk, as the catalog says. */
const sizeOf = (model: string) =>
  model === glimmerBuild('glimmer-gpu').model
    ? glimmerBuild('glimmer-gpu').diskBytes
    : GLIMMER_BYTES;

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
async function standIns(
  chat: readonly OllamaTurn[],
  downloaded: readonly string[] = [STUDENT_MODEL],
): Promise<StandIns> {
  const ollama = await startFakeOllama(chat, {
    models: downloaded.map((name) => ({
      name,
      sizeBytes: sizeOf(name),
      digest: `sha256:${'a'.repeat(64)}`,
    })),
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
async function stubComputer(
  app: ElectronApplication,
  ollamaUrl: string,
  downloaded: readonly string[] = [STUDENT_MODEL],
): Promise<void> {
  await stubEngine(app, {
    'connections:detectLocal': {
      ...FLOW_LOCAL,
      ollama: {
        ...FLOW_LOCAL.ollama,
        baseUrl: ollamaUrl,
        models: downloaded.map((id) => ({ id, sizeBytes: sizeOf(id) })),
      },
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

/**
 * The personal world's Ollama holds both Glimmer builds: the 4-bit one its job trains, and the
 * 2-bit one the imported sample agent runs on.
 */
const PERSONAL_MODELS = [STUDENT_MODEL, glimmerBuild('glimmer-gpu').model];

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
  const models = await standIns(RETURNS_DESK_CHAT, PERSONAL_MODELS);
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
        // The returns desk's weeks of work since its version was accepted, for its home.
        const versions = store.versions.list(summary.graduateId);
        const active = versions.at(-1);
        if (active) {
          const history = agentHistory([
            {
              graduateId: summary.graduateId,
              version: active.version,
              since: active.acceptedAt ?? active.createdAt,
              sessions: ACTIVITY_PLANS.returnsDesk,
            },
          ]);
          for (const chat of history.chats) store.chats.insert(chat);
          for (const message of history.messages) store.messages.insert(message);
        }
      } finally {
        store.close();
      }
    },
  });
  await stubComputer(launched.app, student.baseUrl, PERSONAL_MODELS);
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

/** Academy desk's three runs, each told by its own story. */
const ACADEMY_STORIES = [ACADEMY_RUN, ACADEMY_EARLIER_RUN, ACADEMY_MINI_RUN];

/**
 * What each run's screens read of its rounds and evidence: Academy desk's runs their own, every
 * other run the service desk story's, and the team's runs their cards with no rounds kept.
 */
async function runEvidence(app: ElectronApplication, details: Record<string, RunDetail>) {
  const { 'graduates:installation': _installation, ...evidence } = STORY_EVIDENCE;
  await stubEngine(app, evidence);
  const academy = new Set(ACADEMY_STORIES.map((story) => story.runId));
  const byRun = <T>(own: (runId: string) => T, other: T) =>
    Object.fromEntries(
      Object.keys(details).map((runId) => [runId, academy.has(runId) ? own(runId) : other]),
    );
  await stubByKey(app, 'runs:get', details);
  await stubByKey(
    app,
    'mentoring:capabilities',
    byRun((runId) => ({ ...FIELD_CAPABILITIES, runId }), storyCapabilities),
  );
  await stubByKey(
    app,
    'mentoring:progress',
    byRun((runId) => {
      const { run, job } = details[runId] as RunDetail;
      return {
        ...storyProgress,
        runId,
        dev: { baseline: run.devBaseline, current: run.devCurrent },
        budget: { ...storyProgress.budget, ...job.budget },
      };
    }, storyProgress),
  );
  await stubByKey(
    app,
    'runs:roundDiff',
    byRun(() => ACADEMY_ROUND_DIFF, roundDiff),
  );
  // A try's steps, by its id: Academy desk's runs show the one their band round came from.
  await stubByKey(app, 'runs:trace', {
    ...Object.fromEntries(recentAttempts.map((attempt) => [attempt.id, trace])),
    ...Object.fromEntries(
      ACADEMY_STORIES.flatMap((story) =>
        (details[story.runId] as RunDetail).recentAttempts.map((attempt) => [
          attempt.id,
          academyTrace(story),
        ]),
      ),
    ),
  });
}

/**
 * Start training plays the story's run in the Lab, in about 25 seconds: round 4 kept, rounds 5
 * to 7 practiced, diagnosed, scored and decided, the final test, then the agent. Whichever job it
 * is started from, the run is the service desk's.
 */
async function liveTraining(app: ElectronApplication, details: Record<string, RunDetail>) {
  const later = laterRounds().map(([ms, events]): [number, RunEvent[]] => [3_000 + ms, events]);
  const trained = (later.at(-1)?.[0] ?? 3_000) + 1_000;
  const steps: [number, RunEvent[]][] = [
    [3_000, roundFourKept()],
    ...later,
    [trained, finalTest(20)],
    [trained + 2_000, finalTest(40)],
    [trained + 4_000, finalTest(60)],
    [trained + 6_000, finished()],
  ];
  await runEvidence(app, { ...details, [FLOW.runId]: detail });
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
 * The Lab's fields with the team's agents' jobs among them: Assay desk's field taught by the run
 * its agent came from, and Inventory desk's beside it, each with that run's card. Returns the
 * training screens of every run, the team's two with no rounds kept.
 */
async function teamFields(app: ElectronApplication): Promise<Record<string, RunDetail>> {
  const inventory = TEAM_RECORDS.jobs.find((job) => job.id !== LAB.assayDeskJob);
  if (!inventory) throw new Error("The team's lead has a job of its own.");
  const runOf = (jobId: string) => TEAM_RECORDS.runs.find((run) => run.jobId === jobId);
  const latest = (summary: JobSummary): JobSummary => {
    const run = runOf(summary.id);
    if (!run) return summary;
    const { id, method, status, phase, devCurrent, devBaseline } = run;
    return {
      ...summary,
      latestRun: { id, method, status, phase, devCurrent, devBaseline, accepted: true },
    };
  };
  const tasks = readFileSync(join(REPO, 'examples/inventory-desk/job/tasks.jsonl'), 'utf8');
  const jobs = [
    ...LAB_JOBS.map(latest),
    latest({
      id: inventory.id,
      name: inventory.name,
      createdAt: inventory.createdAt,
      taskCount: tasks.split('\n').filter((line) => line.trim()).length,
    }),
  ];
  const ids = jobs.map((job) => job.id);
  const cards = Object.fromEntries(
    Object.values(TEAM_RECORDS.reports).map((card) => [card.runId, card]),
  );
  const lead = cards[runOf(inventory.id)?.id ?? ''];
  const tested = lead?.test.perOrg?.reduce((sum, row) => sum + row.total, 0) ?? 0;
  await stubEngine(app, { 'jobs:list': jobs });
  await stubByKey(app, 'jobs:get', { ...JOBS, [inventory.id]: inventory });
  await stubByKey(app, 'jobs:field', {
    ...FIELD_VIEWS,
    [inventory.id]: exampleField('inventory-desk', inventory.id, tested),
  });
  await stubByKey(app, 'jobs:taskPlan', { ...TASK_PLANS, [inventory.id]: taskPlan });
  await stubByKey(app, 'runs:list', {
    ...RUNS,
    ...Object.fromEntries(TEAM_RECORDS.runs.map((run) => [run.jobId, [run]])),
  });
  await stubByKey(app, 'reports:list', {
    ...REPORT_TARGETS,
    ...Object.fromEntries(TEAM_RECORDS.runs.map((run) => [run.id, ['hosted']])),
  });
  await stubByKey(app, 'runs:qualifications', Object.fromEntries(ids.map((id) => [id, []])));
  await stubByKey(
    app,
    'mentoring:fieldCounterexamples',
    Object.fromEntries(
      ids.map((id) => [id, id === LAB.academyDeskJob ? ACADEMY_DESK_COUNTEREXAMPLES : []]),
    ),
  );
  await stubByKey(
    app,
    'graduates:certifications',
    Object.fromEntries(
      [...LAB_AGENTS, TEAM_AGENTS.lead, TEAM_AGENTS.teammate].map((agent) => [agent.id, []]),
    ),
  );
  return {
    ...DETAILS,
    ...Object.fromEntries(
      TEAM_RECORDS.runs.map((run) => [
        run.id,
        {
          run,
          job: TEAM_RECORDS.jobs.find((job) => job.id === run.jobId) ?? inventory,
          rounds: [],
          recentAttempts: [],
          lineage: [],
        } satisfies RunDetail,
      ]),
    ),
  };
}

/**
 * Academy desk's version 2, tested on this computer when it graduated and again on the hosted
 * copy since, with what the meter read while its final test ran here.
 */
async function academyRetest(app: ElectronApplication): Promise<void> {
  const cards = {
    ...FIELD_REPORTS,
    ...Object.fromEntries(Object.values(TEAM_RECORDS.reports).map((card) => [card.runId, card])),
    [FLOW.runId]: reports[FLOW.runId],
    [LAB.academyDeskRun]: {
      ...FIELD_REPORTS[LAB.academyDeskRun],
      certificate: ACADEMY_DESK_CERTIFICATE,
    },
  };
  await app.evaluate(
    ({ ipcMain }, { cards, retest, run }) => {
      ipcMain.removeHandler('reports:get');
      ipcMain.handle('reports:get', (_event, runId: string, target?: string) => {
        if (runId === run && target === 'hosted') return { ok: true, value: retest };
        return runId in cards
          ? { ok: true, value: cards[runId] }
          : { ok: false, error: { message: `Nothing is stored for ${runId}.` } };
      });
    },
    {
      cards,
      retest: { ...HOSTED_RETEST_REPORT, certificate: ACADEMY_DESK_CERTIFICATE },
      run: LAB.academyDeskRun,
    },
  );
  await stubByKey(app, 'reports:list', {
    ...REPORT_TARGETS,
    ...Object.fromEntries(TEAM_RECORDS.runs.map((run) => [run.id, ['hosted']])),
    [LAB.academyDeskRun]: ['local', 'hosted'],
  });
  // Every other run's final test ran with no meter.
  await app.evaluate(
    ({ ipcMain }, { measured, run }) => {
      ipcMain.removeHandler('runs:runtimeMeasurements');
      ipcMain.handle('runs:runtimeMeasurements', (_event, runId: string) => ({
        ok: true,
        value: runId === run ? measured : [],
      }));
    },
    { measured: [FIELD_MEASUREMENT], run: LAB.academyDeskRun },
  );
}

/** The Lab's agents' weeks of work since their versions were accepted, for their homes. */
const LAB_ACTIVITY: AgentActivity[] = [
  activityOf(AGENT_WITH_VERSIONS, ACTIVITY_PLANS.serviceDesk),
  activityOf(ACADEMY_DESK_AGENT, ACTIVITY_PLANS.academyDesk),
  activityOf(TEAM_AGENTS.lead, ACTIVITY_PLANS.inventoryDesk),
  activityOf(TEAM_AGENTS.teammate, ACTIVITY_PLANS.assayDesk),
];

/**
 * The agents' chats in the Lab: the service desk's, Academy desk's and the team's, and any chat
 * started with an agent, where every message gets one fixed reply, since no agent runs here.
 */
async function labChats(app: ElectronApplication): Promise<void> {
  const history = agentHistory(LAB_ACTIVITY);
  const chats: WorkspaceChat[] = [
    ...Object.values(CHATS),
    { ...FIELD_CHAT, graduateId: ACADEMY_DESK_ID },
    TEAM_CHAT,
    ...history.chats,
  ];
  const messages: WorkspaceMessage[] = [
    ...MESSAGES,
    ...FIELD_MESSAGES,
    ...TEAM_MESSAGES,
    ...history.messages,
  ];
  await app.evaluate(
    ({ BrowserWindow, ipcMain }, seed) => {
      const { chats, messages } = structuredClone(seed);
      const broadcast = (payload: unknown) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('workspace:onEvent', payload);
        }
      };
      const handle = (channel: string, reply: (...args: never[]) => unknown) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
          try {
            return { ok: true, value: await reply(...(args as never[])) };
          } catch (error) {
            return { ok: false, error: { message: (error as Error).message } };
          }
        });
      };
      const chatOf = (id: string) => {
        const found = chats.find((chat) => chat.id === id);
        if (!found) throw new Error(`No chat ${id}.`);
        return found;
      };
      // The host lists an agent's chats most recently used first.
      handle('workspace:listChats', (graduateId: string) =>
        chats
          .filter((chat) => chat.graduateId === graduateId && chat.teamId === undefined)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
      handle('workspace:blockedConnections', () => []);
      handle('workspace:messages', (chatId: string) =>
        messages.filter((message) => message.chatId === chatId),
      );
      handle('workspace:createChat', (graduateId: string) => {
        const now = new Date().toISOString();
        const chat = {
          id: `cht_new_${chats.length + 1}`,
          graduateId,
          title: 'New chat',
          createdAt: now,
          updatedAt: now,
          running: false,
          waiting: false,
        };
        chats.unshift(chat);
        return chat;
      });
      handle('workspace:send', (chatId: string, text: string) => {
        const chat = chatOf(chatId);
        const now = new Date().toISOString();
        const said = (role: 'user' | 'agent', words: string) => {
          const message = {
            id: `msg_new_${messages.length + 1}`,
            chatId,
            role,
            createdAt: now,
            text: words,
            steps: [],
            blocks: [],
            status: 'done' as const,
          };
          messages.push(message);
          broadcast({ type: 'message.updated', message });
        };
        said('user', text);
        said('agent', 'No agent runs in this world, so every message gets this same reply.');
        const title =
          chat.title === 'New chat' ? text.split(' ').slice(0, 6).join(' ') : chat.title;
        Object.assign(chat, { title, updatedAt: now });
        broadcast({ type: 'chat.updated', chat });
      });
    },
    { chats, messages },
  );
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
    ...Object.fromEntries(Object.values(TEAM_RECORDS.reports).map((card) => [card.runId, card])),
    [FLOW.runId]: reports[FLOW.runId],
    [LAB.academyDeskRun]: {
      ...FIELD_REPORTS[LAB.academyDeskRun],
      certificate: ACADEMY_DESK_CERTIFICATE,
    },
  });
  await installExperimentsFake(
    app,
    sweepComparison(report),
    undefined,
    [
      // Sweep desk's finished experiment is the one with its paper.
      ...LAB_EXPERIMENTS.filter((item) => item.input.name !== SWEEP_EXPERIMENT.input.name),
      SWEEP_EXPERIMENT,
    ],
    // A new experiment is planned on the field chosen for it.
    [...LAB_JOBS, ...TEAM_RECORDS.jobs].map(({ id, name }) => ({ id, name })),
  );
  const details = await teamFields(app);
  await labChats(app);
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
  await liveTraining(app, details);
  await liveExperiments(app);
  await academyRetest(app);
  // Glimmer's 4-bit build stays loaded from the last chat: most of it on the 12 GB card, the
  // rest in system memory, as the meter read during Academy desk's final test.
  await stubEngine(app, {
    'connections:detectLocal': {
      ...FLOW_LOCAL,
      ollama: {
        ...FLOW_LOCAL.ollama,
        baseUrl: models.defaultStudent.baseUrl,
        models: [
          {
            id: STUDENT_MODEL,
            sizeBytes: GLIMMER_BYTES,
            inMemory: {
              totalBytes: FIELD_MEASUREMENT.peakProcessBytes ?? 0,
              gpuBytes: FIELD_MEASUREMENT.peakGpuBytes ?? 0,
            },
          },
        ],
      },
    },
  });
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
