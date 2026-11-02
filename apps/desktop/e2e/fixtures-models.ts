import {
  GraduateVersionSchema,
  type EvaluationStatus,
  type FileDiff,
  type GraduateSummary,
  type GraduateVersion,
  type Job,
  type ReportCard,
  type Run,
  type VersionEvent,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { EARLIER_REPORT, FIELD_JOB, FIELD_REPORT, MINI_REPORT } from './fixtures-field';
import { LAB_AGENTS, MINI_ID, ACADEMY_DESK_ID, stubLab } from './fixtures-lab';
import {
  SWEEP_DESK_ID,
  SWEEP_DESK_JOB,
  SWEEP_EARLIER_REPORT,
  SWEEP_REPORT,
} from './fixtures-science';
import { hex, manifestFor } from './fixtures-versions';
import { at, FINAL_TEST, job, makeRun, STORY, storyReport } from './story';

/*
 * The registry of models against a stand-in engine: the service desk with four versions (its
 * first, the active one with trained weights, a candidate below its target, and one imported from
 * another computer), Academy desk with two versions taught on three academies and tested on one it never
 * saw and on a real one, Academy desk Mini, a second agent for Academy desk's job on a larger build, and
 * Sweep desk with a version from each of its two runs. Each version that took its final test
 * holds its run's card, so its score, date and spend are the ones its field shows. Promoting
 * moves the active version, so the registry reads what the real engine would.
 */

const ACADEMY_DESK_JOB: Job = { ...FIELD_JOB, id: 'job_academy_desk' };

interface VersionSpec {
  graduateId: string;
  job: Job;
  version: number;
  state: GraduateVersion['state'];
  active: boolean;
  status: EvaluationStatus;
  /** The card of the run that made it: its final test, its run and its date. */
  report?: ReportCard;
  /** For a version no run here made, the day it came, after the story's run. */
  day?: number;
  parent?: number;
  imported?: boolean;
  /** The adapter's checksum, its first seven characters, for a version with trained weights. */
  adapter?: string;
  /** The harness hash, seven characters a person reads. */
  harness: string;
  quantization?: string;
}

function makeVersion(spec: VersionSpec): GraduateVersion {
  const createdAt = spec.report?.createdAt ?? at(180 + (spec.day ?? 0) * 24 * 60);
  const score = spec.report?.test.score;
  const manifest = manifestFor({
    job: spec.job,
    agentId: spec.graduateId,
    version: spec.version,
    ...(spec.parent === undefined ? {} : { parent: spec.parent }),
    createdAt,
    status: spec.status,
    ...(score ? { score } : {}),
    ...(spec.adapter ? { adapter: true } : {}),
  });
  const adapterSha = spec.adapter ? `${spec.adapter}${hex('0').slice(7)}` : undefined;
  return GraduateVersionSchema.parse({
    graduateId: spec.graduateId,
    version: spec.version,
    ...(spec.parent === undefined ? {} : { parent: spec.parent }),
    ...(spec.imported
      ? { origin: { agentId: 'grd_servicedesk_dana', version: 2, digest: hex('f') } }
      : {}),
    state: spec.state,
    active: spec.active,
    evaluation: spec.status,
    contractVersion: 1,
    digest: hex(String(spec.version)),
    path: `graduates/${spec.graduateId}/versions/${spec.version}`,
    manifest: {
      ...manifest,
      model: {
        ...manifest.model,
        base: {
          ...manifest.model.base,
          ...(spec.quantization ? { quantization: spec.quantization } : {}),
        },
        ...(manifest.model.adapter && adapterSha
          ? { adapter: { ...manifest.model.adapter, sha256: adapterSha } }
          : {}),
      },
      harness: { ...manifest.harness, hash: `${spec.harness}${hex('0').slice(7)}` },
      integrity: {
        ...manifest.integrity,
        files: manifest.integrity.files.map((file) =>
          file.path === 'adapter/adapter.gguf' && adapterSha
            ? { ...file, sha256: adapterSha }
            : file,
        ),
      },
    },
    ...(spec.report ? { runId: spec.report.runId } : {}),
    createdAt,
    ...(spec.state === 'accepted' ? { acceptedAt: createdAt } : {}),
  });
}

/** A service desk run's card: the story's final test moved by a few tasks of a type. */
function deskReport(
  runId: string,
  createdAt: string,
  bump: Partial<Record<string, number>>,
  dev: ReportCard['dev'],
  cost: Pick<ReportCard['cost'], 'mentorUsd' | 'studentUsd' | 'rounds' | 'wallMs'>,
  topInterventions: ReportCard['topInterventions'],
): ReportCard {
  const perType = FINAL_TEST.map((type) => ({ ...type, pass: type.pass + (bump[type.type] ?? 0) }));
  const score = {
    pass: perType.reduce((sum, type) => sum + type.pass, 0),
    total: perType.reduce((sum, type) => sum + type.total, 0),
  };
  const actual = score.pass / score.total;
  return {
    ...storyReport,
    runId,
    createdAt,
    test: { ...storyReport.test, perType, score },
    dev,
    cost: {
      ...storyReport.cost,
      ...cost,
      mentorInputTokens: Math.round(cost.mentorUsd * 480_000),
      mentorOutputTokens: Math.round(cost.mentorUsd * 89_000),
    },
    topInterventions,
    requirements: { passRate: { target: 0.9, actual, met: actual >= 0.9 } },
  };
}

/**
 * The service desk's cards, one for each run that made a version: the story's run (version 1),
 * the run that trained a LoRA adapter on its verified answers (version 2), and the improvement
 * that made version 3 from a correction.
 */
const DESK_REPORTS = {
  1: storyReport,
  2: deskReport(
    'run_servicedesk_lora',
    at(180 + 24 * 60),
    { scheduling: 2 },
    {
      baseline: { pass: 36, total: 40 },
      final: { pass: 75, total: 80 },
      curve: [
        { round: 0, score: { pass: 36, total: 40 }, decision: 'baseline' },
        { round: 1, score: { pass: 75, total: 80 }, decision: 'kept' },
        { round: 2, score: { pass: 37, total: 40 }, decision: 'reverted' },
      ],
    },
    { mentorUsd: 0.27, studentUsd: 1.84, rounds: 2, wallMs: 96 * 60_000 },
    [{ round: 1, title: 'Train a LoRA adapter on its verified answers', delta: 2, runs: 2 }],
  ),
  3: deskReport(
    'run_improve_1',
    at(180 + 2 * 24 * 60),
    { invoice: -3, overdue: -1 },
    {
      baseline: { pass: 75, total: 80 },
      final: { pass: 70, total: 80 },
      curve: [
        { round: 0, score: { pass: 75, total: 80 }, decision: 'baseline' },
        { round: 1, score: { pass: 70, total: 80 }, decision: 'kept' },
      ],
    },
    { mentorUsd: 0.62, studentUsd: 0.31, rounds: 1, wallMs: 34 * 60_000 },
    [],
  ),
} satisfies Record<number, ReportCard>;

const desk = (spec: Omit<VersionSpec, 'graduateId' | 'job'>) =>
  makeVersion({ ...spec, graduateId: STORY.graduateId, job });

const DESK_VERSIONS: GraduateVersion[] = [
  desk({
    version: 1,
    state: 'accepted',
    active: false,
    status: 'ready',
    report: DESK_REPORTS[1],
    harness: '4b7d2e1',
  }),
  desk({
    version: 2,
    state: 'accepted',
    active: true,
    parent: 1,
    status: 'ready',
    report: DESK_REPORTS[2],
    adapter: '3c9e1f0',
    harness: '9a3f60c',
  }),
  desk({
    version: 3,
    state: 'candidate',
    active: false,
    parent: 2,
    status: 'experimental',
    report: DESK_REPORTS[3],
    adapter: 'b84d27e',
    harness: 'e51c08b',
  }),
  desk({
    version: 4,
    state: 'candidate',
    active: false,
    parent: 2,
    imported: true,
    status: 'unevaluated',
    day: 2,
    harness: '27c9d4a',
  }),
];

/** The runs the service desk's versions came from, as its field lists them. */
export const DESK_RUNS: Run[] = Object.values(DESK_REPORTS).map((report, index) =>
  makeRun({
    id: report.runId,
    jobId: STORY.jobId,
    status: 'finished',
    phase: 'done',
    createdAt: new Date(Date.parse(report.createdAt) - report.cost.wallMs).toISOString(),
    updatedAt: report.createdAt,
    endedAt: report.createdAt,
    currentVersion: STORY.version + index,
    devBaseline: report.dev.baseline,
    devCurrent: report.dev.final,
    graduateId: STORY.graduateId,
    totals: {
      ...makeRun({}).totals,
      mentorUsd: report.cost.mentorUsd,
      rounds: report.cost.rounds,
      wallMs: report.cost.wallMs,
    },
  }),
);

const academyDesk = (graduateId: string, spec: Omit<VersionSpec, 'graduateId' | 'job'>) =>
  makeVersion({ ...spec, graduateId, job: ACADEMY_DESK_JOB });

const ACADEMY_DESK_VERSIONS: GraduateVersion[] = [
  academyDesk(ACADEMY_DESK_ID, {
    version: 1,
    state: 'accepted',
    active: false,
    status: 'experimental',
    report: EARLIER_REPORT,
    harness: 'c03e7f2',
  }),
  academyDesk(ACADEMY_DESK_ID, {
    version: 2,
    state: 'accepted',
    active: true,
    parent: 1,
    status: 'ready',
    report: FIELD_REPORT,
    harness: '61b8a9d',
  }),
];

const MINI_VERSIONS: GraduateVersion[] = [
  academyDesk(MINI_ID, {
    version: 1,
    state: 'accepted',
    active: true,
    status: 'ready',
    report: MINI_REPORT,
    harness: '61b8a9d',
    quantization: 'Q8_0',
  }),
];

const sweepDesk = (spec: Omit<VersionSpec, 'graduateId' | 'job'>) =>
  makeVersion({ ...spec, graduateId: SWEEP_DESK_ID, job: SWEEP_DESK_JOB });

/** Sweep desk's versions, one from each run, each with the final test its run's card holds. */
const SWEEP_VERSIONS: GraduateVersion[] = [
  sweepDesk({
    version: 1,
    state: 'accepted',
    active: false,
    status: 'experimental',
    report: SWEEP_EARLIER_REPORT,
    harness: '5d0a93e',
  }),
  sweepDesk({
    version: 2,
    state: 'accepted',
    active: true,
    parent: 1,
    status: 'ready',
    report: SWEEP_REPORT,
    harness: 'a7e214c',
  }),
];

const REPORTS: Record<string, ReportCard> = {
  [`${STORY.graduateId}:1`]: DESK_REPORTS[1],
  [`${STORY.graduateId}:2`]: DESK_REPORTS[2],
  [`${STORY.graduateId}:3`]: DESK_REPORTS[3],
  [`${ACADEMY_DESK_ID}:1`]: EARLIER_REPORT,
  [`${ACADEMY_DESK_ID}:2`]: FIELD_REPORT,
  [`${MINI_ID}:1`]: MINI_REPORT,
  [`${SWEEP_DESK_ID}:1`]: SWEEP_EARLIER_REPORT,
  [`${SWEEP_DESK_ID}:2`]: SWEEP_REPORT,
};

const AGENTS: GraduateSummary[] = LAB_AGENTS;

const PATCH = {
  agents: [
    '@@ -4,6 +4,9 @@',
    ' Work from the academy’s own files: its topics, its question bank and its policy.',
    ' Share a student’s record only with the academy’s staff.',
    '-Write a short hint in your own words.',
    '+Choose the first hint from the topic’s approved catalog by its hint_id.',
    '+Never write a hint of your own.',
    '+When the policy says escalation is due, add a staff note.',
    ' ',
    ' Keep the answer to what the staff member asked.',
  ].join('\n'),
  skill: [
    '@@ -0,0 +1,6 @@',
    '+# First hint',
    '+',
    '+1. Find the error behind the wrong choice in errors.csv.',
    '+2. Take the hint written for that error from hints.csv, else the topic’s general one.',
    '+3. Give its hint_id and its words as written; never write a hint.',
    '+4. Never give the right choice away.',
  ].join('\n'),
  sweep: [
    '@@ -3,5 +3,8 @@',
    " Work from the group's own files: its sweeps, runs, configs, metrics and policy.",
    '-A run diverged if its status says it failed.',
    '+A run diverged if its training loss is ever NaN or infinite, or crosses the factor in policy.md.',
    '+Never read divergence from status.',
    '+Pair runs by seed before saying whether a change helped.',
    ' ',
    ' Ask before writing to proposed_runs.csv or decisions.csv.',
  ].join('\n'),
  desk: [
    '@@ -2,5 +2,6 @@',
    ' Close out the day for a home-services office.',
    '-Round prices to the dollar.',
    '+Work in cents; round only the invoice total.',
    '+Add zone travel time before booking the next slot.',
    ' Ask before writing to any file.',
  ].join('\n'),
};

const DIFFS: Record<string, FileDiff[]> = {
  academy_desk: [
    { path: 'AGENTS.md', status: 'modified', patch: PATCH.agents },
    { path: 'skills/hint/SKILL.md', status: 'added', patch: PATCH.skill },
  ],
  desk: [{ path: 'AGENTS.md', status: 'modified', patch: PATCH.desk }],
  sweep: [{ path: 'AGENTS.md', status: 'modified', patch: PATCH.sweep }],
};

/** A moment a number of minutes after a card was filed. */
const after = (report: ReportCard, minutes: number) =>
  new Date(Date.parse(report.createdAt) + minutes * 60_000).toISOString();

const HISTORY: Record<string, VersionEvent[]> = {
  [STORY.graduateId]: [
    { graduateId: STORY.graduateId, kind: 'created', version: 1, at: DESK_REPORTS[1].createdAt },
    { graduateId: STORY.graduateId, kind: 'accepted', version: 2, at: after(DESK_REPORTS[2], 10) },
    {
      graduateId: STORY.graduateId,
      kind: 'promoted',
      version: 2,
      from: 1,
      at: after(DESK_REPORTS[2], 15),
    },
  ],
  [ACADEMY_DESK_ID]: [
    { graduateId: ACADEMY_DESK_ID, kind: 'created', version: 1, at: EARLIER_REPORT.createdAt },
    { graduateId: ACADEMY_DESK_ID, kind: 'accepted', version: 2, at: after(FIELD_REPORT, 2) },
    {
      graduateId: ACADEMY_DESK_ID,
      kind: 'promoted',
      version: 2,
      from: 1,
      at: after(FIELD_REPORT, 5),
    },
  ],
  [MINI_ID]: [{ graduateId: MINI_ID, kind: 'created', version: 1, at: MINI_REPORT.createdAt }],
  [SWEEP_DESK_ID]: [
    { graduateId: SWEEP_DESK_ID, kind: 'accepted', version: 2, at: after(SWEEP_REPORT, 0) },
    {
      graduateId: SWEEP_DESK_ID,
      kind: 'promoted',
      version: 2,
      from: 1,
      at: after(SWEEP_REPORT, 5),
    },
  ],
};

export const MODELS = { academyDeskId: ACADEMY_DESK_ID, miniId: MINI_ID, deskId: STORY.graduateId };

/** Every agent's versions, by agent. */
export const MODEL_VERSIONS: Record<string, GraduateVersion[]> = {
  [STORY.graduateId]: DESK_VERSIONS,
  [ACADEMY_DESK_ID]: ACADEMY_DESK_VERSIONS,
  [MINI_ID]: MINI_VERSIONS,
  [SWEEP_DESK_ID]: SWEEP_VERSIONS,
};

/** Each version's report card, by agent and number: `grd_academy_desk:2`. */
export const MODEL_REPORTS: Readonly<Record<string, ReportCard>> = REPORTS;

/**
 * The Lab's stand-in, then the registry's channels on top: every agent's versions, each
 * version's report card by agent and number, harness diffs, history, and promotion that moves
 * the active version. `more` adds versions after an agent's own (or gives an agent the registry
 * doesn't list its first), with their cards. Every call is recorded in `globalThis.modelCalls`.
 */
export async function installModelsFake(
  app: ElectronApplication,
  more: { versions: GraduateVersion[]; reports: Record<string, ReportCard> } = {
    versions: [],
    reports: {},
  },
): Promise<void> {
  await stubLab(app);
  const versions: Record<string, GraduateVersion[]> = Object.fromEntries(
    Object.entries(MODEL_VERSIONS).map(([id, list]) => [id, [...list]]),
  );
  for (const version of more.versions) (versions[version.graduateId] ??= []).push(version);
  const data = {
    agents: AGENTS,
    versions,
    reports: { ...REPORTS, ...more.reports },
    diffs: DIFFS,
    history: HISTORY,
  };
  await app.evaluate(({ ipcMain }, data) => {
    const store = globalThis as typeof globalThis & {
      modelCalls?: { channel: string; args: unknown[] }[];
    };
    store.modelCalls = [];
    const versions = structuredClone(data.versions);
    let agents = structuredClone(data.agents);
    const handle = (channel: string, reply: (...args: never[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        store.modelCalls?.push({ channel, args });
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
    const activate = (id: string, number: number) => {
      for (const item of versions[id] ?? []) item.active = item.version === number;
      agents = agents.map((agent) =>
        agent.id === id ? { ...agent, activeVersion: number } : agent,
      );
      return agents.find((agent) => agent.id === id);
    };
    handle('graduates:list', () => agents);
    handle('graduates:versions', (id: string) => versions[id] ?? []);
    handle('graduates:history', (id: string) => data.history[id] ?? []);
    handle('graduates:settings', () => ({ writeMode: 'ask' }));
    // Without a number, the engine reads the active version's card.
    handle('graduates:report', (id: string, number?: number) => {
      const version = number ?? versions[id]?.find((item) => item.active)?.version;
      const report = data.reports[`${id}:${version}`];
      if (!report) throw new Error(`No locked test measured version ${version}.`);
      return report;
    });
    handle('graduates:harnessDiff', (from: { graduateId: string }, to: { graduateId: string }) =>
      from.graduateId === 'grd_servicedesk' && to.graduateId === 'grd_servicedesk'
        ? data.diffs.desk
        : from.graduateId === 'grd_sweep_desk' && to.graduateId === 'grd_sweep_desk'
          ? data.diffs.sweep
          : data.diffs.academy_desk,
    );
    handle('graduates:acceptVersion', (id: string, number: number) => {
      const found = versions[id]?.find((item) => item.version === number);
      if (!found) throw new Error(`No version ${number}.`);
      found.state = 'accepted';
      return found;
    });
    handle('graduates:promote', (id: string, number: number) => activate(id, number));
    handle('graduates:rollback', (id: string, number: number) => activate(id, number));
    handle('workspace:listChats', () => []);
    handle('teach:list', () => []);
    handle('teach:improvements', () => []);
  }, data);
}
