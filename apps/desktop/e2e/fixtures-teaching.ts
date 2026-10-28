import {
  CorrectionSchema,
  IMPROVE_MAX_ROUNDS,
  ImprovementSchema,
  RunDetailSchema,
  type Correction,
  type CorrectionProposal,
  type GraduateSummary,
  type GraduateVersion,
  type Improvement,
  type RunDetail,
  type TeachingOverview,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { STORY_VERSION, VERSIONS } from './fixtures-versions';
import { AT, at, graduate, job, makeRun, round, STORY } from './story';

/*
 * Teach this, the teaching queue and Improve agent, against a stand-in engine in the main
 * process. It keeps state the way the engine does: a flagged answer becomes a proposed lesson,
 * a lesson is queued, applied as a version or discarded, and an improvement runs to a new
 * version of the agent while its active version keeps answering.
 */

/** Service desk on version 2, which answers in the workspace; version 1 stays for rollback. */
export const TEACHING_VERSIONS: GraduateVersion[] = VERSIONS.slice(0, 2);

export const TEACHING_AGENT: GraduateSummary = { ...graduate, activeVersion: 2, versions: 2 };

/** What the engine says about teaching Service desk here: nothing shared yet, the job's budget. */
const SERVICE_DESK_TEACHING: TeachingOverview = {
  graduateId: STORY.graduateId,
  sharesCorrections: false,
  mentor: job.mentor.label,
  correctionCapUsd: 0.25,
  // The job's 12 rounds, cut to the 10 one improvement may be given, as the engine says.
  improve: {
    fromVersion: 2,
    budget: { ...job.budget, maxRounds: IMPROVE_MAX_ROUNDS },
    training: false,
    waits: false,
  },
};

/** Returns desk, installed from someone else's package: its job isn't on this computer. */
export const IMPORTED_AGENT: GraduateSummary = {
  ...graduate,
  id: 'grd_returns',
  name: 'Returns desk',
  manifest: { ...graduate.manifest, id: 'grd_returns', name: 'Returns desk', jobId: 'job_returns' },
  activeVersion: 1,
  versions: 1,
};

/** Its one version, from the other computer, active since it was installed. */
const IMPORTED_VERSION: GraduateVersion = {
  ...STORY_VERSION,
  graduateId: IMPORTED_AGENT.id,
  origin: { agentId: 'grd_returns_dana', version: 1, digest: 'f'.repeat(64) },
  path: `graduates/${IMPORTED_AGENT.id}/versions/1`,
};

const IMPORTED_TEACHING: TeachingOverview = {
  graduateId: IMPORTED_AGENT.id,
  sharesCorrections: false,
  correctionCapUsd: 0.25,
  unavailable: {
    reason: 'imported',
    message:
      'Returns desk was made on another computer. It can be taught there, where its practice and check tasks are.',
  },
};

export const IMPORTED_CHAT: WorkspaceChat = {
  id: 'cht_returns',
  graduateId: IMPORTED_AGENT.id,
  title: 'Can order 1187 come back?',
  createdAt: AT,
  updatedAt: AT,
  running: false,
  waiting: false,
  graduateVersion: 1,
};

export const IMPORTED_MESSAGES: WorkspaceMessage[] = [
  {
    id: 'msg_returns_1',
    chatId: IMPORTED_CHAT.id,
    role: 'user',
    createdAt: AT,
    text: 'Can order 1187 still be returned?',
    steps: [],
    blocks: [],
    status: 'done',
  },
  {
    id: 'msg_returns_2',
    chatId: IMPORTED_CHAT.id,
    role: 'agent',
    createdAt: AT,
    text: 'Yes. It was delivered on Oct 9, so its 30-day window runs to Nov 8.',
    steps: [],
    blocks: [],
    status: 'done',
    graduateVersion: 1,
  },
];

/** The lessons Spark proposes, in the order flagged answers reach it. */
export const PROPOSALS: CorrectionProposal[] = [
  {
    kind: 'procedure',
    lesson: 'Count an invoice as overdue only when it is unpaid and past its due date.',
    reason: 'You state a rule it should follow every time, and its instructions never say it.',
    instruction:
      'An invoice is overdue only when it is unpaid and its due date has passed; after a partial payment, only the rest is overdue.',
    taskType: 'overdue',
  },
  {
    kind: 'weakness',
    lesson: 'Match each payment to its invoice by invoice number before adding up what is owed.',
    reason:
      'Its instructions already say to match payments by invoice number, and it added them up by customer anyway.',
    taskType: 'overdue',
  },
  {
    kind: 'invalid',
    lesson: 'The total it gave is wrong.',
    reason:
      'The three open balances it read add up to $2,915.00, the total it gave, so the correction contradicts the exchange.',
  },
];

function correction(
  id: string,
  proposal: CorrectionProposal,
  fields: Partial<Correction> & Pick<Correction, 'status' | 'wrong'>,
): Correction {
  return CorrectionSchema.parse({
    id,
    graduateId: STORY.graduateId,
    version: 2,
    chatId: 'cht_closeout',
    messageId: 'msg_close_2',
    proposal,
    mentorModel: 'muse-spark-1.3',
    costUsd: 0.013,
    sharedAt: at(400),
    createdAt: at(400),
    updatedAt: at(400),
    ...fields,
  });
}

/** One lesson waiting for the person and two in the queue. */
export const FLAGGED: Correction[] = [
  correction(
    'cor_booking',
    {
      kind: 'procedure',
      lesson: 'Ask which day before booking when a request names none.',
      reason: "Its instructions don't say what to do when a request names no day.",
      instruction: 'When a booking request names no day, ask which day before booking anything.',
      taskType: 'scheduling',
    },
    {
      status: 'proposed',
      wrong: 'It booked Thursday when I never said a day.',
      createdAt: at(470),
    },
  ),
  correction('cor_payments', PROPOSALS[1]!, {
    status: 'queued',
    wrong: 'It counted the Brennan payment against the wrong invoice.',
    createdAt: at(450),
  }),
  correction(
    'cor_sources',
    {
      kind: 'source',
      lesson: 'What a customer owes is total_cents minus paid_cents in invoices.csv.',
      reason: 'You name the columns that hold the right amounts.',
      instruction:
        'Work out what a customer owes from data/invoices.csv as total_cents minus paid_cents, never from its status column.',
      taskType: 'overdue',
    },
    { status: 'queued', wrong: 'It used the wrong payment date for Okafor.', createdAt: at(430) },
  ),
];

/** The first improvement's run. */
export const IMPROVE_RUN_ID = 'run_improve_1';

/** An improvement's run as the training view loads it, a few minutes in. */
const IMPROVING: RunDetail = RunDetailSchema.parse({
  run: makeRun({
    id: IMPROVE_RUN_ID,
    status: 'running',
    phase: 'attempting',
    createdAt: at(500),
    updatedAt: at(506),
    currentVersion: 8,
    devBaseline: { pass: 37, total: 40 },
    devCurrent: { pass: 37, total: 40 },
    totals: {
      mentorUsd: 0.04,
      mentorInputTokens: 18_000,
      mentorOutputTokens: 3_100,
      studentInputTokens: 410_000,
      studentOutputTokens: 52_000,
      rounds: 1,
      attempts: 52,
      wallMs: 6 * 60_000,
    },
  }),
  // The run's copy of its job carries the improvement's own caps.
  job: { ...job, budget: { ...job.budget, maxRounds: IMPROVE_MAX_ROUNDS } },
  rounds: [
    round(1, {
      runId: IMPROVE_RUN_ID,
      status: 'attempting',
      train: { pass: 4, total: 6 },
      startedAt: at(504),
    }),
  ],
  recentAttempts: [],
  lineage: [],
  // The stand-in names the lessons each improvement takes when it starts.
  improves: { graduateId: STORY.graduateId, version: 2, corrections: ['cor_payments'] },
});

/**
 * How an improvement ends in the engine's records: version 3, better on overdue balances and
 * the same elsewhere, within a fraction of its budget.
 */
export const FINISHED: Pick<Improvement, 'status' | 'spentUsd' | 'dev' | 'perType' | 'promotion'> =
  ImprovementSchema.pick({
    status: true,
    spentUsd: true,
    dev: true,
    perType: true,
    promotion: true,
  }).parse({
    status: 'finished',
    spentUsd: 0.62,
    dev: { before: { pass: 37, total: 40 }, after: { pass: 39, total: 40 } },
    perType: [
      {
        type: 'invoice',
        before: { type: 'invoice', pass: 13, total: 14 },
        after: { type: 'invoice', pass: 13, total: 14 },
      },
      {
        type: 'overdue',
        before: { type: 'overdue', pass: 11, total: 13 },
        after: { type: 'overdue', pass: 13, total: 13 },
      },
      {
        type: 'scheduling',
        before: { type: 'scheduling', pass: 13, total: 13 },
        after: { type: 'scheduling', pass: 13, total: 13 },
      },
    ],
    promotion: {
      allowed: true,
      reason:
        "Accept version 3, then promote it when you're ready. Its gain was measured on dev; no locked test measured it.",
    },
  });

export interface TeachingSeed {
  versions: GraduateVersion[];
  corrections: Correction[];
  /** Whether Service desk's job already lets flagged answers go to the mentor. */
  shares: boolean;
}

/** Everything the stand-in starts from, sent to the main process once. */
function teachingData(seed: TeachingSeed) {
  return {
    seed,
    agents: [TEACHING_AGENT, IMPORTED_AGENT],
    overviews: [{ ...SERVICE_DESK_TEACHING, sharesCorrections: seed.shares }, IMPORTED_TEACHING],
    proposals: PROPOSALS,
    improving: IMPROVING,
    imported: IMPORTED_VERSION,
    job: { id: job.id, name: job.name },
  };
}
type TeachingData = ReturnType<typeof teachingData>;

/**
 * Answers the teach channels, the agents, their versions and the improvement's run in the main
 * process, with state. Calls are recorded with the workspace fake's, so a test can check what
 * was sent and when. Install it after the workspace fake.
 */
export async function installTeachingFake(
  app: ElectronApplication,
  seed: TeachingSeed,
): Promise<void> {
  // Sent untyped: the data's types are too deep for Playwright to unbox, and it is ours anyway.
  const sent: unknown = teachingData(seed);
  await app.evaluate(({ BrowserWindow, ipcMain }, raw) => {
    const data = raw as TeachingData;
    type Fake = {
      calls: { channel: string; args: unknown[] }[];
      teaching?: { finish: (finished: unknown) => void };
    };
    type Detail = typeof data.improving;
    type Improvement = {
      runId: string;
      graduateId: string;
      fromVersion: number;
      status: string;
      corrections: string[];
      budget: { maxRounds: number; maxMentorUsd: number };
      spentUsd: number;
      dev: { before: { pass: number; total: number } | null; after: unknown };
      perType: unknown[];
      candidateVersion?: number;
      promotion: { allowed: boolean; reason: string };
    };
    const fake = (globalThis as unknown as { fakeEngine: Fake }).fakeEngine;
    const agents = data.agents.map((agent) => ({ ...agent }));
    const versions = data.seed.versions.map((item) => ({ ...item }));
    const corrections = data.seed.corrections.map((item) => ({ ...item }));
    const overviews = data.overviews.map((overview) => ({ ...overview }));
    const improvements: Improvement[] = [];
    const details: Record<string, Detail> = {};
    let proposed = 0;

    const broadcast = (channel: string, payload: unknown) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
    };
    const handle = (channel: string, reply: (...args: never[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        fake.calls.push({ channel, args });
        try {
          return { ok: true, value: await reply(...(args as never[])) };
        } catch (error) {
          return {
            ok: false,
            error: { message: error instanceof Error ? error.message : 'Failed' },
          };
        }
      });
    };
    const now = () => new Date().toISOString();
    const overviewOf = (graduateId: string) => {
      const found = overviews.find((overview) => overview.graduateId === graduateId);
      if (!found) throw new Error(`There is no graduate "${graduateId}".`);
      return found;
    };
    const correctionOf = (id: string) => {
      const found = corrections.find((item) => item.id === id);
      if (!found) throw new Error(`There is no correction "${id}".`);
      return found;
    };
    const nextVersion = () => Math.max(...versions.map((item) => item.version)) + 1;
    /** A new version from the active one, waiting as a candidate that no test measured. */
    const addCandidate = (number: number) => {
      const active = versions.find((item) => item.active) ?? versions[0]!;
      const { summary: _measured, ...evidence } = active.manifest.evidence;
      versions.push({
        ...active,
        version: number,
        parent: active.version,
        state: 'candidate',
        active: false,
        evaluation: 'unevaluated',
        digest: String(number % 10).repeat(64),
        path: `graduates/${active.graduateId}/versions/${number}`,
        manifest: {
          ...active.manifest,
          identity: { ...active.manifest.identity, version: number },
          evidence: { ...evidence, status: 'unevaluated' },
        },
        createdAt: now(),
      });
    };
    const runEvent = (runId: string, run: unknown) =>
      broadcast('runs:onEvent', { type: 'run.updated', runId, at: now(), run });

    handle('graduates:list', () => agents);
    let chats = 0;
    handle('workspace:createChat', (graduateId: string) => {
      chats += 1;
      const at = now();
      return {
        id: `cht_teach_${chats}`,
        graduateId,
        title: 'New chat',
        createdAt: at,
        updatedAt: at,
        running: false,
        waiting: false,
        graduateVersion: 2,
      };
    });
    handle('graduates:versions', (graduateId: string) =>
      graduateId === data.imported.graduateId ? [data.imported] : versions,
    );
    handle('graduates:acceptVersion', (_id: string, number: number) => {
      const found = versions.find((item) => item.version === number);
      if (!found) throw new Error(`No version ${number}.`);
      found.state = 'accepted';
      return found;
    });
    handle('graduates:promote', (graduateId: string, number: number) => {
      for (const item of versions) item.active = item.version === number;
      for (const item of improvements) {
        if (item.candidateVersion === number) {
          item.promotion = { allowed: false, reason: `Version ${number} is already active.` };
        }
      }
      const agent = agents.find((item) => item.id === graduateId);
      if (!agent) throw new Error(`There is no graduate "${graduateId}".`);
      agent.activeVersion = number;
      return agent;
    });
    handle('teach:overview', (graduateId: string) => overviewOf(graduateId));
    handle('teach:shareCorrections', (graduateId: string, allowed: boolean) =>
      Object.assign(overviewOf(graduateId), { sharesCorrections: allowed }),
    );
    handle('teach:list', (graduateId: string) =>
      corrections.filter((item) => item.graduateId === graduateId),
    );
    handle(
      'teach:propose',
      (
        chatId: string,
        messageId: string,
        request: { wrong: string; wanted?: string; evidence?: string; consent: boolean },
      ) => {
        if (!request.consent) {
          throw new Error(
            'Nothing was sent: the mentor reads this exchange only once you agree to share it.',
          );
        }
        const proposal = data.proposals[proposed % data.proposals.length]!;
        proposed += 1;
        const at = now();
        const made = {
          id: `cor_new${proposed}`,
          graduateId: overviews[0]!.graduateId,
          version: 2,
          chatId,
          messageId,
          wrong: request.wrong,
          ...(request.wanted === undefined ? {} : { wanted: request.wanted }),
          ...(request.evidence === undefined ? {} : { evidence: request.evidence }),
          proposal,
          status: 'proposed' as const,
          mentorModel: 'muse-spark-1.3',
          costUsd: 0.013,
          sharedAt: at,
          createdAt: at,
          updatedAt: at,
        };
        corrections.unshift(made);
        return made;
      },
    );
    handle('teach:queue', (id: string) => Object.assign(correctionOf(id), { status: 'queued' }));
    handle('teach:discard', (id: string) =>
      Object.assign(correctionOf(id), { status: 'discarded' }),
    );
    handle('teach:apply', (id: string) => {
      const number = nextVersion();
      addCandidate(number);
      return Object.assign(correctionOf(id), { status: 'applied', candidateVersion: number });
    });
    handle('teach:improvements', (graduateId: string) =>
      improvements.filter((item) => item.graduateId === graduateId).reverse(),
    );
    handle(
      'teach:improve',
      (graduateId: string, options: { maxRounds: number; maxMentorUsd: number }) => {
        const runId = `run_improve_${improvements.length + 1}`;
        const taken = corrections.filter((item) => item.status === 'queued');
        for (const item of taken) Object.assign(item, { runId });
        const ids = taken.map((item) => item.id);
        details[runId] = {
          ...data.improving,
          run: { ...data.improving.run, id: runId, updatedAt: now() },
          rounds: data.improving.rounds.map((item) => ({ ...item, runId })),
          improves: { graduateId, version: 2, corrections: ids },
        };
        improvements.push({
          runId,
          graduateId,
          fromVersion: 2,
          status: 'running',
          corrections: ids,
          budget: options,
          spentUsd: 0.04,
          dev: { before: { pass: 37, total: 40 }, after: null },
          perType: [],
          promotion: { allowed: false, reason: 'It is still running.' },
        });
        runEvent(runId, details[runId].run);
        return {
          runId,
          started: true,
          note: 'Improving Service desk from version 2, within its budget.',
        };
      },
    );
    handle('runs:get', (runId: string) => {
      const detail = details[runId];
      if (!detail) throw new Error(`There is no run "${runId}".`);
      return detail;
    });
    // An improvement's Train screen reads the run's mentoring records, as any run's does: this
    // improvement has no lessons, interventions or experiments yet, and its job no categories.
    const noRun = (runId: string) => {
      if (!details[runId]) throw new Error(`There is no run "${runId}".`);
    };
    for (const channel of [
      'mentoring:lessons',
      'mentoring:interventions',
      'mentoring:experiments',
    ]) {
      handle(channel, (runId: string) => {
        noRun(runId);
        return [];
      });
    }
    handle('mentoring:categories', () => []);
    handle('mentoring:progress', (runId: string) => {
      noRun(runId);
      const detail = details[runId];
      return {
        runId,
        experiments: { total: 0, kept: 0, reverted: 0, rejected: 0, invalid: 0, stopped: 0 },
        dev: { baseline: detail?.run.devBaseline ?? null, current: detail?.run.devCurrent ?? null },
        lessons: { verified: 0, rejected: 0, byKind: {} },
        clarifications: 0,
        spent: {
          mentorUsd: 0,
          mentorInputTokens: 0,
          mentorOutputTokens: 0,
          studentUsd: 0,
          studentInputTokens: 0,
          studentOutputTokens: 0,
          computeUsd: 0,
          computeMinutes: 0,
          examples: 0,
          trainedTokens: 0,
          attempts: 0,
          minutes: 0,
        },
        budget: {
          maxRounds: detail?.job.budget.maxRounds ?? 1,
          maxMentorUsd: detail?.job.budget.maxMentorUsd ?? 0,
          maxComputeUsd: 0,
          maxWallMinutes: detail?.job.budget.maxWallMinutes ?? 1,
        },
      };
    });
    handle('runs:stop', (runId: string) => {
      const detail = details[runId];
      const improvement = improvements.find((item) => item.runId === runId);
      if (!detail || !improvement) throw new Error(`There is no run "${runId}".`);
      detail.run = {
        ...detail.run,
        status: 'stopped',
        phase: 'done',
        stopReason: 'user',
        endedAt: now(),
        updatedAt: now(),
      };
      Object.assign(improvement, {
        status: 'stopped',
        promotion: {
          allowed: false,
          reason: 'It was stopped before it made a version, so there is nothing to promote.',
        },
      });
      for (const item of corrections) {
        if ('runId' in item && item.runId === runId) delete item.runId;
      }
      runEvent(runId, detail.run);
    });
    // The sidebar lists the job while its improvement runs, as it lists any training.
    handle('jobs:list', () => {
      const running = improvements.find((item) => item.status === 'running');
      const run = running ? details[running.runId]?.run : undefined;
      if (!run) return [];
      return [
        {
          id: data.job.id,
          name: data.job.name,
          createdAt: run.createdAt,
          taskCount: 180,
          latestRun: {
            id: run.id,
            status: run.status,
            phase: run.phase,
            method: run.method,
            devCurrent: run.devCurrent,
            devBaseline: run.devBaseline,
          },
        },
      ];
    });

    fake.teaching = {
      finish: (finished) => {
        const improvement = improvements.at(-1);
        const detail = improvement ? details[improvement.runId] : undefined;
        if (!improvement || !detail) throw new Error('No improvement is running.');
        const number = nextVersion();
        addCandidate(number);
        Object.assign(improvement, finished as object, { candidateVersion: number });
        for (const item of corrections) {
          if ('runId' in item && item.runId === improvement.runId) {
            Object.assign(item, { status: 'used', candidateVersion: number });
          }
        }
        detail.run = {
          ...detail.run,
          status: 'finished',
          phase: 'done',
          endedAt: now(),
          updatedAt: now(),
          graduateId: improvement.graduateId,
          devCurrent: { pass: 39, total: 40 },
          totals: { ...detail.run.totals, rounds: 2, wallMs: 14 * 60_000, mentorUsd: 0.62 },
        };
        detail.rounds = detail.rounds.map((item) => ({
          ...item,
          status: 'decided' as const,
          title: 'Match payments to invoices by number',
          decision: 'kept' as const,
          devBefore: { pass: 37, total: 40 },
          devAfter: { pass: 39, total: 40 },
        }));
        runEvent(improvement.runId, detail.run);
        broadcast('runs:onEvent', {
          type: 'graduate.ready',
          runId: improvement.runId,
          at: now(),
          graduateId: improvement.graduateId,
        });
      },
    };
  }, sent);
}

/** Ends the newest improvement with a new version, as the engine would, and says so. */
export async function finishImprovement(app: ElectronApplication): Promise<void> {
  await app.evaluate((_electron, finished) => {
    const fake = (
      globalThis as unknown as { fakeEngine: { teaching: { finish: (f: unknown) => void } } }
    ).fakeEngine;
    fake.teaching.finish(finished);
  }, FINISHED);
}
