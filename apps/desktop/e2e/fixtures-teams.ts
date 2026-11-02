import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASK_TEAMMATE,
  CorrectionSchema,
  describeCall,
  describeResult,
  GraduateVersionSchema,
  JobSchema,
  type Consultation,
  type Correction,
  type CorrectionRequest,
  type GraduateSummary,
  type GraduateVersion,
  type Installation,
  type Job,
  type OrgTypeResult,
  type ReportCard,
  type Run,
  type Team,
  type TypeResult,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { LLAMA_SERVER_READY, NOTHING_LOCAL } from './fixtures';
import { installation, manifestFor } from './fixtures-versions';
import { at, graduate, makeRun, storyReport } from './story';

/*
 * A team on the stand-in engine (decision 100): its lead answers in a team chat and asks its
 * teammate for part of the request, each working on its own organization's files. The jobs,
 * organizations, files and the values the agents read are the shipped examples' own; the scores
 * are stand-ins, as every capture's are. This world is apart from the science lab's
 * (fixtures-science.ts), so neither spec's counts change the other's; where both are in one
 * world, Assay desk's job is the Lab's own field of that name.
 */

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url));

function exampleJob(folder: string, id: string): Job {
  const job = JobSchema.parse(
    JSON.parse(readFileSync(join(EXAMPLES, folder, 'job', 'job.json'), 'utf8')),
  );
  // Kept before its agent's run, so no run predates its job.
  return { ...job, id, createdAt: at(-3_200) };
}

/** A task of an example's own, by its id. */
function exampleTask(folder: string, id: string): { prompt: string; expected: unknown } {
  const line = readFileSync(join(EXAMPLES, folder, 'job', 'tasks.jsonl'), 'utf8')
    .split('\n')
    .find((text) => text.includes(`"id":"${id}"`));
  if (!line) throw new Error(`No task ${id} in ${folder}.`);
  return JSON.parse(line) as { prompt: string; expected: unknown };
}

/** An organization's file of an example, as rows under its header. */
function exampleRows(folder: string, org: string, file: string): string[][] {
  return readFileSync(join(EXAMPLES, folder, 'job', 'orgs', org, 'data', file), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(','));
}

/** One agent of the team, as each of the screens reads it. */
interface TeamAgent {
  summary: GraduateSummary;
  version: GraduateVersion;
  report: ReportCard;
  /** The run its version came from, finished and tested. */
  run: Run;
  installation: Installation;
  job: Job;
}

/** An agent at one version, tested at each organization of its job, bound to one of them. */
function teamAgent(options: {
  id: string;
  job: Job;
  version: number;
  /** Passes of 2 at each organization taught on, 8 at the one never seen, by skill. */
  passes: Readonly<Record<string, readonly number[]>>;
  org: string;
  path: string;
}): TeamAgent {
  const { id, job } = options;
  const orgs = job.organizations ?? [];
  const perOrg: OrgTypeResult[] = job.taskTypes.flatMap((skill, index) =>
    orgs.map((org) => ({
      type: skill.id,
      label: skill.label,
      org: org.id,
      orgName: org.name,
      seen: org.role === 'train',
      synthetic: org.synthetic,
      pass: options.passes[org.id]?.[index] ?? 0,
      total: org.role === 'train' ? 2 : 8,
    })),
  );
  const perType: TypeResult[] = job.taskTypes.map((skill) => {
    const seen = perOrg.filter((row) => row.type === skill.id && row.seen);
    return {
      type: skill.id,
      label: skill.label,
      pass: seen.reduce((sum, row) => sum + row.pass, 0),
      total: seen.reduce((sum, row) => sum + row.total, 0),
      refused: false,
    };
  });
  const score = {
    pass: perType.reduce((sum, type) => sum + type.pass, 0),
    total: perType.reduce((sum, type) => sum + type.total, 0),
  };
  const runId = `run_${id}`;
  const createdAt = at(-2_000);
  const version = GraduateVersionSchema.parse({
    graduateId: id,
    version: options.version,
    state: 'accepted',
    active: true,
    evaluation: 'ready',
    contractVersion: 1,
    digest: 'f'.repeat(64),
    path: `graduates/${id}/versions/${options.version}`,
    manifest: manifestFor({
      job,
      agentId: id,
      version: options.version,
      createdAt,
      status: 'ready',
      score,
    }),
    runId,
    createdAt,
    acceptedAt: createdAt,
  });
  const summary: GraduateSummary = {
    ...graduate,
    id,
    name: job.name,
    path: `graduates/${id}`,
    activeVersion: options.version,
    versions: options.version,
    manifest: {
      ...graduate.manifest,
      id,
      name: job.name,
      jobId: job.id,
      runId,
      requirements: {
        passRate: {
          target: 0.9,
          actual: score.pass / score.total,
          met: score.pass / score.total >= 0.9,
        },
      },
      test: { score, perType },
    },
  };
  const report: ReportCard = {
    ...storyReport,
    jobId: job.id,
    runId,
    name: job.name,
    organizationNoun: job.organizationNoun,
    createdAt,
    test: { ...storyReport.test, score, perType, perOrg, refusals: 0 },
    refusedTypes: [],
    topInterventions: [],
    requirements: summary.manifest.requirements,
  };
  const run = makeRun({
    id: runId,
    jobId: job.id,
    status: 'finished',
    phase: 'done',
    createdAt: at(-2_200),
    updatedAt: createdAt,
    endedAt: createdAt,
    currentVersion: 8,
    devBaseline: report.dev.baseline,
    devCurrent: report.dev.final,
    graduateId: id,
    totals: {
      ...makeRun({}).totals,
      mentorUsd: report.cost.mentorUsd,
      rounds: report.cost.rounds,
      wallMs: report.cost.wallMs,
    },
  });
  return {
    summary,
    version,
    report,
    run,
    installation: installation(id, {
      version: options.version,
      bindings: { data: `${options.path}\\orgs\\${options.org}\\data` },
    }),
    job,
  };
}

export const TEAM_ID = 'team_screening';
const LEAD_ID = 'grd_inventory_desk';
const TEAMMATE_ID = 'grd_assay_desk';

const LEAD_JOB = exampleJob('inventory-desk', 'job_inventory_desk');
const ASSAY_JOB = exampleJob('assay-desk', 'job_assay_desk');

/** Both agents work on Fenwick Screening Core's records. */
const ORG = 'fenwick';

const LEAD = teamAgent({
  id: LEAD_ID,
  job: LEAD_JOB,
  version: 1,
  passes: {
    fenwick: [2, 2, 2, 2],
    'alder-row': [2, 2, 1, 2],
    saltmarsh: [2, 1, 2, 2],
    'corvid-hill': [7, 6, 6, 7],
  },
  org: ORG,
  path: 'C:\\Users\\ines\\Fenwick\\inventory',
});

const TEAMMATE = teamAgent({
  id: TEAMMATE_ID,
  job: ASSAY_JOB,
  version: 1,
  passes: {
    fenwick: [2, 2, 2, 2, 2, 2],
    'alder-row': [2, 1, 2, 2, 2, 2],
    saltmarsh: [2, 2, 2, 1, 2, 2],
    'corvid-hill': [7, 6, 7, 6, 6, 7],
  },
  org: ORG,
  path: 'C:\\Users\\ines\\Fenwick\\assay',
});

export const TEAM_AGENTS = { lead: LEAD.summary, teammate: TEAMMATE.summary };
/**
 * The team's agents' versions, report cards and install checks, for a world whose registry lists
 * them beside other agents, and their jobs and the runs their versions came from, for one whose
 * fields hold them.
 */
export const TEAM_RECORDS = {
  versions: [LEAD.version, TEAMMATE.version],
  reports: { [`${LEAD_ID}:1`]: LEAD.report, [`${TEAMMATE_ID}:1`]: TEAMMATE.report },
  installations: { [LEAD_ID]: LEAD.installation, [TEAMMATE_ID]: TEAMMATE.installation },
  jobs: [LEAD.job, TEAMMATE.job],
  runs: [LEAD.run, TEAMMATE.run],
};

/** The team the person makes in Models: Inventory desk leads, and asks Assay desk. */
export const TEAM: Team = {
  id: TEAM_ID,
  name: 'Screening logistics',
  members: [{ graduateId: LEAD_ID }, { graduateId: TEAMMATE_ID }],
  createdAt: at(600),
  updatedAt: at(600),
};

/*
 * The examples' team demo at Fenwick (examples/inventory-desk/README.md). Assay desk writes up
 * plate FW-0418 and says which re-tests its policy calls for (`fenwick-plate_report-01`); in a
 * consult a teammate can't write (decision 107), so Inventory desk proposes both writes: the
 * re-tests queued in retests.csv, and stock held for exactly those compounds
 * (`fenwick-reserve-01`). Every value on screen is read from those tasks' expected answers and
 * the labs' own files.
 */
interface PlateReport {
  plate: string;
  z_prime: number;
  qc: 'pass' | 'fail';
  hits: string[];
  retests: {
    requested_on: string;
    qc_reason: string;
    plates: {
      plate: string;
      whole: boolean;
      candidates: { compound: string; reason: string }[];
    }[];
    ids: string[];
  };
}
interface Reservation {
  allocations: {
    compound: string;
    draws: { lot: string; location: string; amount_ul: number }[];
    reason: string | null;
  }[];
  reserved_on: string;
  ids: string[];
}
const REPORT_TASK = exampleTask('assay-desk', 'fenwick-plate_report-01');
const RESERVE_TASK = exampleTask('inventory-desk', 'fenwick-reserve-01');
const REPORT = (REPORT_TASK.expected as { params: PlateReport }).params;
const RESERVE = (RESERVE_TASK.expected as { params: Reservation }).params;

const PLATES = exampleRows('assay-desk', ORG, 'plates.csv');
const RETESTS = exampleRows('assay-desk', ORG, 'retests.csv');
const INVENTORY = exampleRows('inventory-desk', ORG, 'inventory.csv');
const RESERVATIONS = exampleRows('inventory-desk', ORG, 'reservations.csv');
const POLICY = readFileSync(
  join(EXAMPLES, 'inventory-desk', 'job', 'orgs', ORG, 'data', 'policy.md'),
  'utf8',
);

/** A setting of the policy's table: `| Combine lots for one re-test | no |`. */
function policySetting(name: string): string {
  const row = POLICY.split('\n').find((line) => line.startsWith(`| ${name} |`));
  if (!row) throw new Error(`No setting ${name} in the policy.`);
  return row.split('|')[2]?.trim() ?? '';
}

const header = (rows: string[][]) => rows[0] ?? [];
const plain = (rows: string[][]) => rows.slice(1);

/** The rows Assay desk says to add to retests.csv, one per compound of the plate to re-test. */
const RETEST_ROWS: string[][] = (() => {
  const ids = [...REPORT.retests.ids];
  return REPORT.retests.plates.flatMap((plate) =>
    plate.candidates.map((candidate) => [
      ids.shift() ?? '',
      plate.plate,
      candidate.compound,
      candidate.reason,
      REPORT.retests.requested_on,
    ]),
  );
})();
const CANDIDATES = REPORT.retests.plates.flatMap((plate) => plate.candidates);
const COMPOUNDS = CANDIDATES.map((candidate) => candidate.compound);

/** The rows Inventory desk adds to reservations.csv: one per lot it draws from. */
const HOLD_ROWS: string[][] = (() => {
  const ids = [...RESERVE.ids];
  return RESERVE.allocations.flatMap((allocation) =>
    allocation.draws.map((draw) => [
      ids.shift() ?? '',
      allocation.compound,
      draw.lot,
      `${draw.amount_ul} µL`,
      RESERVE.reserved_on,
    ]),
  );
})();
const LOTS = plain(INVENTORY).filter((row) => COMPOUNDS.includes(row[0] ?? ''));
const DRAWN = RESERVE.allocations.filter((allocation) => allocation.draws.length > 0);
const EMPTY = RESERVE.allocations.filter((allocation) => allocation.draws.length === 0);
const PER_RETEST = policySetting('Stock per re-test');
const COMBINES = policySetting('Combine lots for one re-test') === 'yes';

/** "It's Wednesday, October 14, 2026.", the lab's day as the tasks say it. */
const TODAY = `${REPORT_TASK.prompt.split('. ')[0] ?? ''}.`;
const PLATE = REPORT.plate;
const PLATE_ROWS = plain(PLATES).filter((row) => row[0] === PLATE);

const CHAT_ID = 'cht_reserve';
const REPLY_ID = 'msg_reserve_2';
const CONSULT_STEP = 'step-2';

export const TEAM_CHAT: WorkspaceChat = {
  id: CHAT_ID,
  graduateId: LEAD_ID,
  teamId: TEAM_ID,
  title: `Reserve stock for ${PLATE}'s re-tests`,
  createdAt: at(610),
  updatedAt: at(614),
  running: true,
  waiting: true,
  graduateVersion: LEAD.summary.activeVersion ?? 1,
};

const REQUEST = `${TODAY} Reserve stock for ${PLATE}'s re-tests.`;
const ASKED = `${TODAY} Which compounds on plate ${PLATE} need a re-test, and why?`;

const reasonWord = (reason: string) => reason.toLowerCase();
const ANSWER = [
  `${PLATE} ${REPORT.qc === 'pass' ? 'passes' : 'fails'} QC (Z′ ${REPORT.z_prime}). ${CANDIDATES.length} compounds need a re-test: ${CANDIDATES.map(
    (candidate) => `${candidate.compound} is ${reasonWord(candidate.reason)}`,
  ).join(' and ')}. They should be queued in retests.csv as ${REPORT.retests.ids.join(' and ')}.`,
  `ANSWER: ${JSON.stringify({
    plate: PLATE,
    z_prime: REPORT.z_prime,
    qc: REPORT.qc,
    hits: REPORT.hits,
    retests: RETEST_ROWS.length,
  })}`,
].join('\n');

const consultation: Consultation = {
  stepId: CONSULT_STEP,
  graduateId: TEAMMATE_ID,
  version: TEAMMATE.summary.activeVersion ?? 1,
  request: ASKED,
  work: [{ kind: 'model', text: ANSWER, calls: [] }],
  text: ANSWER,
  outcome: 'answered',
};

const expiryOf = (lot: string) => LOTS.find((row) => row[1] === lot)?.[6] ?? '';
const lotsOf = (compound: string) => LOTS.filter((row) => row[0] === compound).length;

const REPLY_TEXT = [
  `${PLATE} passed QC, and Assay desk named ${RETEST_ROWS.length} re-tests. The first change below queues them in retests.csv as ${REPORT.retests.ids.join(' and ')}, and the second holds their stock.`,
  '',
  ...DRAWN.flatMap((allocation) =>
    allocation.draws.map(
      (draw) =>
        `- **${allocation.compound}**: ${draw.amount_ul} µL from lot ${draw.lot} in rack ${draw.location}. It expires on ${expiryOf(draw.lot)}, the first of its usable lots, and the hold below is for it.`,
    ),
  ),
  ...EMPTY.map(
    (allocation) =>
      `- **${allocation.compound}**: nothing usable (${allocation.reason ?? ''}). None of its ${lotsOf(allocation.compound)} lots has ${PER_RETEST} free${COMBINES ? '' : ", and Fenwick doesn't combine lots"}.`,
  ),
].join('\n');

export const TEAM_MESSAGES: WorkspaceMessage[] = [
  {
    id: 'msg_reserve_1',
    chatId: CHAT_ID,
    role: 'user',
    createdAt: at(610),
    text: REQUEST,
    steps: [],
    blocks: [],
    status: 'done',
  },
  {
    id: REPLY_ID,
    chatId: CHAT_ID,
    role: 'agent',
    createdAt: at(610),
    text: REPLY_TEXT,
    steps: [
      {
        id: 'step-1',
        kind: 'tool',
        name: 'read',
        detail: 'data/policy.md',
        status: 'done',
        ms: 600,
      },
      {
        id: CONSULT_STEP,
        kind: 'consult',
        name: 'Assay desk',
        detail: ASKED,
        meta: describeResult(ASK_TEAMMATE, ANSWER),
        status: 'done',
        ms: 46_000,
        view: {
          kind: 'consult',
          graduateId: TEAMMATE_ID,
          version: TEAMMATE.summary.activeVersion ?? 1,
          outcome: 'answered',
          steps: [
            {
              id: 'step-1',
              kind: 'tool',
              name: 'read',
              detail: 'data/policy.md',
              status: 'done',
              ms: 500,
            },
            {
              id: 'step-2',
              kind: 'tool',
              name: 'grep',
              detail: describeCall('grep', { path: 'data/plates.csv', pattern: PLATE }),
              meta: '1 match',
              status: 'done',
              ms: 700,
              view: {
                kind: 'table',
                columns: header(PLATES),
                rows: PLATE_ROWS,
                total: PLATE_ROWS.length,
              },
            },
            {
              id: 'step-3',
              kind: 'tool',
              name: 'run',
              detail: `data/${PLATES.find((row) => row[0] === PLATE)?.[4] ?? ''}, data/compounds.csv`,
              status: 'done',
              ms: 19_000,
              view: {
                kind: 'code',
                code: `const plate = wells('${PLATE}');\nconsole.log(zPrime(plate).toFixed(4));\nfor (const c of retestCandidates(plate)) console.log(c.compound, c.reason);`,
                output: [
                  REPORT.z_prime.toFixed(4),
                  ...CANDIDATES.map((candidate) => `${candidate.compound} ${candidate.reason}`),
                ].join('\n'),
              },
            },
            {
              id: 'step-4',
              kind: 'tool',
              name: 'read',
              detail: 'data/retests.csv',
              meta: `${plain(RETESTS).length} rows`,
              status: 'done',
              ms: 400,
            },
          ],
        },
      },
      {
        id: 'step-3',
        kind: 'tool',
        name: 'grep',
        detail: describeCall('grep', { path: 'data/inventory.csv', pattern: COMPOUNDS.join('|') }),
        meta: `${LOTS.length} matches`,
        status: 'done',
        ms: 800,
        view: { kind: 'table', columns: header(INVENTORY), rows: LOTS, total: LOTS.length },
      },
      {
        id: 'step-4',
        kind: 'tool',
        name: 'read',
        detail: 'data/reservations.csv',
        meta: `${plain(RESERVATIONS).length} rows`,
        status: 'done',
        ms: 700,
      },
      {
        id: 'step-5',
        kind: 'tool',
        name: 'append',
        detail: 'data/retests.csv',
        status: 'running',
      },
      {
        id: 'step-6',
        kind: 'tool',
        name: 'append',
        detail: 'data/reservations.csv',
        status: 'running',
      },
    ],
    blocks: [
      {
        kind: 'approval',
        changeId: 'chg_retests',
        op: 'append',
        file: 'data/retests.csv',
        summary: `Add ${RETEST_ROWS.length} rows to data/retests.csv`,
        diff: { columns: header(RETESTS), added: RETEST_ROWS, removed: [], changed: [] },
        status: 'pending',
      },
      {
        kind: 'approval',
        changeId: 'chg_holds',
        op: 'append',
        file: 'data/reservations.csv',
        summary: `Add ${HOLD_ROWS.length} ${HOLD_ROWS.length === 1 ? 'row' : 'rows'} to data/reservations.csv`,
        diff: { columns: header(RESERVATIONS), added: HOLD_ROWS, removed: [], changed: [] },
        status: 'pending',
      },
    ],
    status: 'streaming',
    graduateVersion: LEAD.summary.activeVersion ?? 1,
    consultations: [consultation],
    team: true,
  },
];

/** The lesson Spark proposes from the flagged answer of Assay desk. */
function proposed(
  graduateId: string,
  version: number,
  chatId: string,
  messageId: string,
  request: CorrectionRequest,
): Correction {
  return CorrectionSchema.parse({
    id: 'cor_team1',
    graduateId,
    version,
    chatId,
    messageId,
    ...(request.step === undefined ? {} : { step: request.step }),
    wrong: request.wrong,
    ...(request.wanted === undefined ? {} : { wanted: request.wanted }),
    proposal: {
      kind: 'procedure',
      lesson: 'Name each compound to re-test with the re-test id it should be queued as.',
      reason: 'You state a rule it should follow every time, and its instructions never say it.',
      instruction:
        'When you say which re-tests to queue, list each row to add as its retest_id, the compound or plate, and the reason code, in the order they should be added.',
      taskType: 'plate_report',
    },
    status: 'proposed',
    mentorModel: 'muse-spark-1.3',
    costUsd: 0.014,
    sharedAt: at(700),
    createdAt: at(700),
    updatedAt: at(700),
  });
}

const AGENTS = [LEAD, TEAMMATE];

export interface TeamWorld {
  agents: TeamAgent[];
  teams: Team[];
  chats: WorkspaceChat[];
  messages: WorkspaceMessage[];
}

export function teamWorld(patch: Partial<TeamWorld> = {}): TeamWorld {
  return { agents: AGENTS, teams: [], chats: [TEAM_CHAT], messages: TEAM_MESSAGES, ...patch };
}

/**
 * Answers the channels a team's screens read, from a world of agents, teams and chats: each
 * agent's own versions, report, installation, settings and teaching, the teams, and the chats by
 * agent or by team. The first new team takes `TEAM_ID`, so the world's team chats are its, and
 * any later one an id of its own, with no chats yet. Calls are recorded; removing an agent that
 * is in a team is refused as the engine refuses it.
 */
export async function installTeamsFake(app: ElectronApplication, world: TeamWorld): Promise<void> {
  const correction = proposed(TEAMMATE_ID, TEAMMATE.summary.activeVersion ?? 1, CHAT_ID, REPLY_ID, {
    wrong: 'It left the request date off.',
    consent: true,
  });
  await app.evaluate(
    ({ BrowserWindow, ipcMain }, { world, teamId, correction, local, llama }) => {
      const calls: { channel: string; args: unknown[] }[] = [];
      const teams = structuredClone(world.teams);
      const chats = structuredClone(world.chats);
      const messages = structuredClone(world.messages);
      const settings: Record<string, { writeMode: string }> = Object.fromEntries(
        world.agents.map((agent) => [agent.summary.id, { writeMode: 'ask' }]),
      );
      const sharing: Record<string, boolean> = {};
      const agentOf = (id: string) => {
        const found = world.agents.find((agent) => agent.summary.id === id);
        if (!found) throw new Error(`No agent ${id}.`);
        return found;
      };
      const broadcast = (payload: unknown) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('workspace:onEvent', payload);
        }
      };
      const handle = (channel: string, reply: (...args: never[]) => unknown) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
          calls.push({ channel, args });
          try {
            return { ok: true, value: await reply(...(args as never[])) };
          } catch (error) {
            const coded = error as { message?: string; code?: string };
            return {
              ok: false,
              error: {
                message: coded.message ?? 'Failed',
                ...(coded.code === undefined ? {} : { code: coded.code }),
              },
            };
          }
        });
      };
      const overview = (graduateId: string) => {
        const agent = agentOf(graduateId);
        return {
          graduateId,
          sharesCorrections: sharing[graduateId] === true,
          mentor: agent.job.mentor.label,
          correctionCapUsd: 0.25,
          improve: {
            fromVersion: agent.summary.activeVersion ?? 1,
            budget: { ...agent.job.budget, maxRounds: Math.min(agent.job.budget.maxRounds, 10) },
            training: false,
            waits: false,
          },
        };
      };

      handle('connections:detectLocal', () => local);
      handle('connections:llamaServer', () => llama);
      handle('graduates:list', () => world.agents.map((agent) => agent.summary));
      handle('graduates:hasSampleAgent', () => false);
      handle('graduates:versions', (id: string) => [agentOf(id).version]);
      handle('graduates:history', () => []);
      handle('graduates:report', (id: string) => agentOf(id).report);
      handle('graduates:installation', (id: string) => agentOf(id).installation);
      handle('graduates:settings', (id: string) => settings[id]);
      handle('graduates:updateSettings', (id: string, patch: { writeMode: string }) => {
        settings[id] = { ...settings[id], ...patch };
        return settings[id];
      });
      handle('graduates:certifications', () => []);
      handle('graduates:remove', (id: string) => {
        const team = teams.find((item) => item.members.some((m) => m.graduateId === id));
        if (!team) return undefined;
        const name = agentOf(id).summary.name;
        throw Object.assign(
          new Error(
            team.members[0]?.graduateId === id
              ? `${name} leads ${team.name}. Remove the team in Models, Teams, first.`
              : `${name} is in ${team.name}. Take it out of the team in Models, Teams, first.`,
          ),
          { code: 'agent_in_team' },
        );
      });
      handle('jobs:list', () => []);
      handle('jobs:get', (id: string) => {
        const found = world.agents.find((agent) => agent.job.id === id);
        if (!found) throw new Error(`No job ${id}.`);
        return found.job;
      });
      handle('teams:list', () => teams);
      handle('teams:create', (input: Pick<Team, 'name' | 'members'>) => {
        const id = teams.some((item) => item.id === teamId) ? `team_${teams.length + 1}` : teamId;
        const team = { id, ...input, createdAt: new Date().toISOString() };
        const made = { ...team, updatedAt: team.createdAt };
        teams.push(made);
        return made;
      });
      handle('teams:update', (id: string, input: Pick<Team, 'name' | 'members'>) => {
        const index = teams.findIndex((item) => item.id === id);
        const current = teams[index];
        if (!current) throw new Error(`No team ${id}.`);
        const next = { ...current, ...input, updatedAt: new Date().toISOString() };
        teams[index] = next;
        return next;
      });
      handle('teams:remove', (id: string) => {
        const index = teams.findIndex((item) => item.id === id);
        if (index !== -1) teams.splice(index, 1);
      });
      handle('workspace:listChats', (id: string) =>
        chats.filter((chat) => chat.graduateId === id && chat.teamId === undefined),
      );
      handle('workspace:listTeamChats', (id: string) =>
        teams.some((team) => team.id === id) ? chats.filter((chat) => chat.teamId === id) : [],
      );
      handle('workspace:createTeamChat', (id: string) => {
        const team = teams.find((item) => item.id === id);
        if (!team) throw new Error(`No team ${id}.`);
        const now = new Date().toISOString();
        const chat = {
          id: `cht_team_${chats.length + 1}`,
          graduateId: team.members[0]?.graduateId ?? '',
          teamId: id,
          title: 'New chat',
          createdAt: now,
          updatedAt: now,
          running: false,
          waiting: false,
        };
        chats.unshift(chat);
        return chat;
      });
      handle('workspace:messages', (chatId: string) =>
        messages.filter((message) => message.chatId === chatId),
      );
      handle('workspace:decide', (changeId: string, decision: string) => {
        const owner = messages.find((message) =>
          message.blocks.some((block) => block.kind === 'approval' && block.changeId === changeId),
        );
        if (!owner) throw new Error(`No change ${changeId}.`);
        const status = decision === 'deny' ? 'denied' : 'approved';
        const blocks = owner.blocks.map((block) =>
          block.kind === 'approval' && block.changeId === changeId ? { ...block, status } : block,
        );
        const settled = !blocks.some(
          (block) => block.kind === 'approval' && block.status === 'pending',
        );
        const message = {
          ...owner,
          blocks,
          ...(settled
            ? {
                status: 'done',
                steps: owner.steps.map((step) =>
                  step.status === 'running' ? { ...step, status: 'done', ms: 1_100 } : step,
                ),
                workedMs: 74_000,
              }
            : {}),
        };
        messages[messages.indexOf(owner)] = message as (typeof messages)[number];
        broadcast({ type: 'message.updated', message });
        const chat = chats.find((item) => item.id === owner.chatId);
        if (chat && settled) {
          Object.assign(chat, { running: false, waiting: false });
          broadcast({ type: 'chat.updated', chat });
        }
      });
      handle('teach:overview', (id: string) => overview(id));
      handle('teach:shareCorrections', (id: string, allowed: boolean) => {
        sharing[id] = allowed;
        return overview(id);
      });
      handle('teach:list', () => []);
      handle('teach:improvements', () => []);
      handle(
        'teach:propose',
        (_chatId: string, _messageId: string, request: { wrong: string; step?: string }) => ({
          ...correction,
          wrong: request.wrong,
          ...(request.step === undefined ? {} : { step: request.step }),
        }),
      );
      Object.assign(globalThis, { teamCalls: calls });
    },
    {
      world,
      teamId: TEAM_ID,
      correction,
      local: NOTHING_LOCAL,
      llama: LLAMA_SERVER_READY,
    },
  );
}

/** The arguments of every call the renderer made on a channel. */
export function teamCallsTo(app: ElectronApplication, channel: string): Promise<unknown[][]> {
  return app.evaluate(
    (_electron, channel) =>
      (globalThis as unknown as { teamCalls: { channel: string; args: unknown[] }[] }).teamCalls
        .filter((call) => call.channel === channel)
        .map((call) => call.args),
    channel,
  );
}
