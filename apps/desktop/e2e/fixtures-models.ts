import {
  GraduateVersionSchema,
  type EvaluationStatus,
  type FileDiff,
  type GraduateSummary,
  type GraduateVersion,
  type Job,
  type OrgTypeResult,
  type ReportCard,
  type Score,
  type VersionEvent,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { FIELD_JOB, FIELD_REPORT } from './fixtures-field';
import { LAB_AGENTS, MINI_ID, PHIL_ID, stubLab } from './fixtures-lab';
import { hex, manifestFor } from './fixtures-versions';
import { at, FINAL_TEST, job, STORY, storyReport } from './story';

/*
 * The registry of models against a stand-in engine: the service desk with four versions (its
 * first, the active one with trained weights, a candidate below its target, and one imported from
 * another computer), Phil with two versions taught on three academies and tested on one it never
 * saw and on a real one, and Phil Mini, a second agent for Phil's job on a larger build. Promoting
 * moves the active version, so the registry reads what the real engine would.
 */

const PHIL_JOB: Job = { ...FIELD_JOB, id: 'job_phil' };

interface VersionSpec {
  graduateId: string;
  job: Job;
  version: number;
  state: GraduateVersion['state'];
  active: boolean;
  status: EvaluationStatus;
  day: number;
  parent?: number;
  imported?: boolean;
  score?: Score;
  /** The adapter's checksum, its first seven characters, for a version with trained weights. */
  adapter?: string;
  /** The harness hash, seven characters a person reads. */
  harness: string;
  quantization?: string;
}

function makeVersion(spec: VersionSpec): GraduateVersion {
  const createdAt = at(180 + spec.day * 24 * 60);
  const manifest = manifestFor({
    job: spec.job,
    agentId: spec.graduateId,
    version: spec.version,
    ...(spec.parent === undefined ? {} : { parent: spec.parent }),
    createdAt,
    status: spec.status,
    ...(spec.score ? { score: spec.score } : {}),
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
    createdAt,
    ...(spec.state === 'accepted' ? { acceptedAt: createdAt } : {}),
  });
}

const desk = (spec: Omit<VersionSpec, 'graduateId' | 'job'>) =>
  makeVersion({ ...spec, graduateId: STORY.graduateId, job });

const DESK_VERSIONS: GraduateVersion[] = [
  desk({
    version: 1,
    state: 'accepted',
    active: false,
    status: 'ready',
    score: { pass: 55, total: 60 },
    day: 0,
    harness: '4b7d2e1',
  }),
  desk({
    version: 2,
    state: 'accepted',
    active: true,
    parent: 1,
    status: 'ready',
    score: { pass: 57, total: 60 },
    adapter: '3c9e1f0',
    day: 1,
    harness: '9a3f60c',
  }),
  desk({
    version: 3,
    state: 'candidate',
    active: false,
    parent: 2,
    status: 'experimental',
    score: { pass: 51, total: 60 },
    adapter: 'b84d27e',
    day: 2,
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

const phil = (graduateId: string, spec: Omit<VersionSpec, 'graduateId' | 'job'>) =>
  makeVersion({ ...spec, graduateId, job: PHIL_JOB });

const PHIL_VERSIONS: GraduateVersion[] = [
  phil(PHIL_ID, {
    version: 1,
    state: 'accepted',
    active: false,
    status: 'experimental',
    score: { pass: 61, total: 72 },
    day: 1,
    harness: 'c03e7f2',
  }),
  phil(PHIL_ID, {
    version: 2,
    state: 'accepted',
    active: true,
    parent: 1,
    status: 'ready',
    score: FIELD_REPORT.test.score,
    day: 2,
    harness: '61b8a9d',
  }),
];

const MINI_VERSIONS: GraduateVersion[] = [
  phil(MINI_ID, {
    version: 1,
    state: 'accepted',
    active: true,
    status: 'ready',
    score: { pass: 68, total: 72 },
    day: 3,
    harness: '61b8a9d',
    quantization: 'Q8_0',
  }),
];

/** A field report with some cells moved by a few tasks, all at the same organizations. */
function shifted(base: ReportCard, change: (result: OrgTypeResult) => number): ReportCard {
  const perOrg = (base.test.perOrg ?? []).map((result) => ({
    ...result,
    pass: Math.max(0, Math.min(result.total, result.pass + change(result))),
  }));
  const seen = perOrg.filter((result) => result.seen);
  const score = {
    pass: seen.reduce((sum, result) => sum + result.pass, 0),
    total: seen.reduce((sum, result) => sum + result.total, 0),
  };
  return { ...base, test: { ...base.test, perOrg, score } };
}

const PHIL_REPORTS = {
  1: {
    ...shifted(FIELD_REPORT, (result) =>
      result.type === 'after_wrong' || result.type === 'hint' ? -1 : result.seen ? 0 : -1,
    ),
    jobId: PHIL_JOB.id,
    runId: 'run_phil_1',
    dev: { ...FIELD_REPORT.dev, final: { pass: 64, total: 80 } },
    topInterventions: [{ round: 2, title: 'Read the policy before assigning', delta: 6 }],
  },
  2: {
    ...FIELD_REPORT,
    jobId: PHIL_JOB.id,
    runId: 'run_phil_2',
    dev: { ...FIELD_REPORT.dev, final: { pass: 71, total: 80 } },
    topInterventions: [
      { round: 3, title: 'Pick hints from the catalog, never write them', delta: 5 },
      { round: 5, title: 'Count history over the policy window', delta: 3, runs: 2 },
    ],
  },
} satisfies Record<number, ReportCard>;

const MINI_REPORT: ReportCard = {
  ...shifted(FIELD_REPORT, (result) => (result.type === 'hint' ? 1 : 0)),
  jobId: PHIL_JOB.id,
  runId: 'run_phil_mini',
  name: 'Phil Mini',
  student: { ...FIELD_REPORT.student, quantization: 'Q8_0' },
  dev: { ...FIELD_REPORT.dev, final: { pass: 73, total: 80 } },
};

const deskReport = (bump: Partial<Record<string, number>>, final: Score): ReportCard => {
  const perType = FINAL_TEST.map((type) => ({ ...type, pass: type.pass + (bump[type.type] ?? 0) }));
  const score = {
    pass: perType.reduce((sum, type) => sum + type.pass, 0),
    total: perType.reduce((sum, type) => sum + type.total, 0),
  };
  return {
    ...storyReport,
    test: { ...storyReport.test, perType, score },
    dev: { ...storyReport.dev, final },
  };
};

const REPORTS: Record<string, ReportCard> = {
  [`${STORY.graduateId}:1`]: deskReport({}, { pass: 72, total: 80 }),
  [`${STORY.graduateId}:2`]: deskReport({ scheduling: 2 }, { pass: 75, total: 80 }),
  [`${STORY.graduateId}:3`]: deskReport({ invoice: -3, overdue: -1 }, { pass: 70, total: 80 }),
  [`${PHIL_ID}:1`]: PHIL_REPORTS[1],
  [`${PHIL_ID}:2`]: PHIL_REPORTS[2],
  [`${MINI_ID}:1`]: MINI_REPORT,
};

const AGENTS: GraduateSummary[] = LAB_AGENTS;

const PATCH = {
  agents: [
    '@@ -4,6 +4,9 @@',
    ' Work from the academy’s own files: its topics, its question bank and its policy.',
    ' Never quote a student’s record to another student.',
    '-Write a short hint in your own words.',
    '+Choose the first hint from the topic’s approved catalog by its hint_id.',
    '+Never write a hint of your own.',
    '+When the policy says escalation is due, add a staff note.',
    ' ',
    ' Keep the answer to what the student asked.',
  ].join('\n'),
  skill: [
    '@@ -0,0 +1,7 @@',
    '+# Assign practice',
    '+',
    '+1. Read the policy: how many questions, which difficulty band.',
    '+2. List the topic’s questions the student hasn’t attempted.',
    '+3. Keep those inside the band, in the bank’s order.',
    '+4. Write that many rows to assignments.csv; nothing else.',
    '+5. Fewer eligible than asked: assign them all and say how many.',
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
  phil: [
    { path: 'AGENTS.md', status: 'modified', patch: PATCH.agents },
    { path: 'skills/assign/SKILL.md', status: 'added', patch: PATCH.skill },
  ],
  desk: [{ path: 'AGENTS.md', status: 'modified', patch: PATCH.desk }],
};

const HISTORY: Record<string, VersionEvent[]> = {
  [STORY.graduateId]: [
    { graduateId: STORY.graduateId, kind: 'created', version: 1, at: at(180) },
    { graduateId: STORY.graduateId, kind: 'accepted', version: 2, at: at(180 + 1500) },
    { graduateId: STORY.graduateId, kind: 'promoted', version: 2, from: 1, at: at(180 + 1510) },
  ],
  [PHIL_ID]: [
    { graduateId: PHIL_ID, kind: 'accepted', version: 2, at: at(180 + 2900) },
    { graduateId: PHIL_ID, kind: 'promoted', version: 2, from: 1, at: at(180 + 2905) },
  ],
  [MINI_ID]: [],
};

export const MODELS = { philId: PHIL_ID, miniId: MINI_ID, deskId: STORY.graduateId };

/** Every agent's versions, by agent. */
export const MODEL_VERSIONS: Record<string, GraduateVersion[]> = {
  [STORY.graduateId]: DESK_VERSIONS,
  [PHIL_ID]: PHIL_VERSIONS,
  [MINI_ID]: MINI_VERSIONS,
};

/**
 * The Lab's stand-in, then the registry's channels on top: every agent's versions, each
 * version's report card by agent and number, harness diffs, history, and promotion that moves
 * the active version. Every call is recorded in `globalThis.modelCalls`.
 */
export async function installModelsFake(app: ElectronApplication): Promise<void> {
  await stubLab(app);
  const data = {
    agents: AGENTS,
    versions: MODEL_VERSIONS,
    reports: REPORTS,
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
    handle('graduates:report', (id: string, number: number) => {
      const report = data.reports[`${id}:${number}`];
      if (!report) throw new Error(`No locked test measured version ${number}.`);
      return report;
    });
    handle('graduates:harnessDiff', (from: { graduateId: string }, to: { graduateId: string }) =>
      from.graduateId === 'grd_servicedesk' && to.graduateId === 'grd_servicedesk'
        ? data.diffs.desk
        : data.diffs.phil,
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
