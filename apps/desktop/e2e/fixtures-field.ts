import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  JobSchema,
  type CapabilityBreakdown,
  type GraduateSummary,
  type Job,
  type OrgTypeResult,
  type ReportCard,
  type TypeResult,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import {
  academyCost,
  academyDev,
  academyInterventions,
  academyVersion,
  ACADEMY_EARLIER_RUN,
  ACADEMY_MINI_RUN,
  ACADEMY_RUN,
  ACADEMY_SKILLS,
  AT,
  graduate,
  storyReport,
  trainedJob,
  type AcademyRunStory,
} from './story';

/*
 * Academy desk, the academy agent of the field plan, as a report and an agent: one specialist trained
 * with three synthetic academies and tested also on one it never saw and on a real one it never
 * saw (decisions 068 and 070). The real one has no question text, so only some skills are tested
 * there. Its job, files and skills are the shipped example's (examples/academy); its runs are the
 * story's (story.ts), and every card here is made from them.
 */

const EXAMPLE = JobSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../examples/academy/job/job.json', import.meta.url)),
      'utf8',
    ),
  ),
);

type Skill = (typeof ACADEMY_SKILLS)[number];

/** Each skill under the name the Lab's screens give it, in the job's order. */
const LABELS: Record<Skill, string> = {
  diagnose: 'Diagnose a wrong answer',
  solve: 'Work the question',
  hint: 'First hint',
  history: 'Topic history',
  assign: 'Assign practice',
  after_wrong: 'Whole tutoring turn',
};

const SKILLS = ACADEMY_SKILLS.map((id) => ({ id, label: LABELS[id] }));

const ORGS: {
  org: string;
  name: string;
  seen: boolean;
  synthetic: boolean;
  /** Each skill tested there, as [pass, total]. */
  results: Partial<Record<Skill, [number, number]>>;
}[] = [
  {
    org: 'northside',
    name: 'Northside Prep',
    seen: true,
    synthetic: true,
    results: {
      diagnose: [4, 4],
      solve: [4, 4],
      hint: [3, 4],
      history: [4, 4],
      assign: [4, 4],
      after_wrong: [3, 4],
    },
  },
  {
    org: 'lakeview',
    name: 'Lakeview Academy',
    seen: true,
    synthetic: true,
    results: {
      diagnose: [4, 4],
      solve: [3, 4],
      hint: [4, 4],
      history: [4, 4],
      assign: [4, 4],
      after_wrong: [3, 4],
    },
  },
  {
    org: 'summit',
    name: 'Summit Tutoring',
    seen: true,
    synthetic: true,
    results: {
      diagnose: [4, 4],
      solve: [4, 4],
      hint: [4, 4],
      history: [3, 4],
      assign: [4, 4],
      after_wrong: [4, 4],
    },
  },
  {
    org: 'harbor',
    name: 'Harbor Learning',
    seen: false,
    synthetic: true,
    results: {
      diagnose: [5, 6],
      solve: [5, 6],
      hint: [5, 6],
      history: [6, 6],
      assign: [5, 6],
      after_wrong: [4, 6],
    },
  },
  {
    org: 'cp',
    name: 'Real academy',
    seen: false,
    synthetic: false,
    results: { diagnose: [9, 10], history: [10, 10], assign: [8, 10] },
  },
];

export const FIELD_ORGS = ORGS;

const PER_ORG: OrgTypeResult[] = SKILLS.flatMap((skill) =>
  ORGS.flatMap((org) => {
    const result = org.results[skill.id];
    if (!result) return [];
    const [pass, total] = result;
    return [
      {
        type: skill.id,
        label: skill.label,
        org: org.org,
        orgName: org.name,
        seen: org.seen,
        synthetic: org.synthetic,
        pass,
        total,
      },
    ];
  }),
);

/** The final test the requirement is judged on: the academies it trained with. */
const PER_TYPE: TypeResult[] = SKILLS.map((skill) => {
  const seen = PER_ORG.filter((row) => row.type === skill.id && row.seen);
  return {
    type: skill.id,
    label: skill.label,
    pass: seen.reduce((sum, row) => sum + row.pass, 0),
    total: seen.reduce((sum, row) => sum + row.total, 0),
    refused: false,
  };
});

const SCORE = {
  pass: PER_TYPE.reduce((sum, type) => sum + type.pass, 0),
  total: PER_TYPE.reduce((sum, type) => sum + type.total, 0),
};

/** Trained on hosted Glimmer with Spark, as the service desk was, on the academy's own files. */
export const FIELD_JOB: Job = {
  ...trainedJob,
  name: 'Academy desk',
  description: EXAMPLE.description,
  organizationNoun: 'academy',
  summary:
    'Tells the academy’s staff what to do when a student misses a question, from the academy’s own curriculum.',
  does: [],
  doesNot: ['Changes a grade or a recorded score'],
  taskTypes: SKILLS.map((skill) => ({
    id: skill.id,
    label: skill.label,
    description: EXAMPLE.taskTypes.find((type) => type.id === skill.id)?.description ?? skill.label,
  })),
  data: EXAMPLE.data,
  permissions: EXAMPLE.permissions,
  budget: EXAMPLE.budget,
  splits: { ...trainedJob.splits, calibration: 12, train: 96, dev: 48, test: 72 },
};

/** A final test as a card holds it, from its results at each organization. */
function testOf(perOrg: OrgTypeResult[]): ReportCard['test'] {
  const perType: TypeResult[] = SKILLS.map((skill) => {
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
  return { ...storyReport.test, score, perType, perOrg, refusals: 0 };
}

/** An academy run's card: its story's check tasks and spend, and its final test. */
function academyCard(story: AcademyRunStory, perOrg: OrgTypeResult[]): ReportCard {
  const test = testOf(perOrg);
  const actual = test.score.pass / test.score.total;
  return {
    ...storyReport,
    jobId: 'job_academy_desk',
    runId: story.runId,
    name: 'Academy desk',
    organizationNoun: 'academy',
    createdAt: story.testedAt,
    test,
    dev: academyDev(story),
    cost: academyCost(story),
    refusedTypes: [],
    topInterventions: academyInterventions(story),
    requirements: { passRate: { target: 0.9, actual, met: actual >= 0.9 } },
    overclaim: null,
  };
}

/** The final test with some cells moved by a task, at the same organizations. */
function moved(change: (result: OrgTypeResult) => number): OrgTypeResult[] {
  return PER_ORG.map((result) => ({
    ...result,
    pass: Math.max(0, Math.min(result.total, result.pass + change(result))),
  }));
}

/** The card of the run Academy desk's active version 2 came from. */
export const FIELD_REPORT: ReportCard = academyCard(ACADEMY_RUN, PER_ORG);

/** Version 1's card: a task fewer on hints and whole turns where it was taught, on all else elsewhere. */
export const EARLIER_REPORT: ReportCard = academyCard(
  ACADEMY_EARLIER_RUN,
  moved((result) =>
    result.type === 'after_wrong' || result.type === 'hint' ? -1 : result.seen ? 0 : -1,
  ),
);

/** Academy desk Mini's card, on Glimmer's 8-bit build: one more first hint wherever it missed one. */
export const MINI_REPORT: ReportCard = {
  ...academyCard(
    ACADEMY_MINI_RUN,
    moved((result) => (result.type === 'hint' ? 1 : 0)),
  ),
  name: 'Academy desk Mini',
  student: { ...storyReport.student, quantization: 'Q8_0' },
};

export const FIELD_CAPABILITIES: CapabilityBreakdown = {
  runId: FIELD_REPORT.runId,
  capabilities: PER_TYPE.map((type) => ({
    type: type.type,
    label: type.label,
    practice: null,
    check: null,
    finalTest: { pass: type.pass, total: type.total },
    installCheck: null,
    categories: [],
  })),
};

export const FIELD_AGENT: GraduateSummary = {
  ...graduate,
  name: 'Academy desk',
  manifest: {
    ...graduate.manifest,
    name: 'Academy desk',
    runId: ACADEMY_RUN.runId,
    createdAt: ACADEMY_RUN.testedAt,
    acceptedAt: ACADEMY_RUN.testedAt,
    harness: {
      version: academyVersion(ACADEMY_RUN),
      round: ACADEMY_RUN.changes.length,
      hash: 'sha256-academy',
    },
    requirements: FIELD_REPORT.requirements,
    test: { score: SCORE, perType: PER_TYPE },
  },
};

/** Where the academies' folders sit on this computer. */
export const ACADEMY_DIR = 'C:\\Users\\dana\\Academies';
export const orgFolder = (org: string) => `${ACADEMY_DIR}\\orgs\\${org}\\data`;

export const FIELD_CHAT: WorkspaceChat = {
  id: 'cht_maya',
  graduateId: FIELD_AGENT.id,
  title: 'Maya missed question 14',
  createdAt: AT,
  updatedAt: AT,
  running: false,
  waiting: true,
};

export const FIELD_MESSAGES: WorkspaceMessage[] = [
  {
    id: 'msg_maya_1',
    chatId: FIELD_CHAT.id,
    role: 'user',
    createdAt: AT,
    text: 'Maya missed question 14 on the linear equations set and chose B. What should she do next?',
    steps: [],
    blocks: [],
    status: 'done',
  },
  {
    id: 'msg_maya_2',
    chatId: FIELD_CHAT.id,
    role: 'agent',
    createdAt: AT,
    text: 'She moved the 3 across without changing its sign (topic ALG-2, rule 4); the answer is D. A first hint: "What happens to a term when it crosses the equals sign?" Per the policy, three more questions on ALG-2 in her band.',
    steps: [
      { id: 's1', kind: 'tool', name: 'read', detail: 'data/policy.md', status: 'done' },
      {
        id: 's2',
        kind: 'tool',
        name: 'grep',
        detail: '/maya/ in data/attempts.csv',
        meta: '18 matches',
        status: 'done',
      },
    ],
    blocks: [
      {
        kind: 'approval',
        changeId: 'chg_assign',
        op: 'append',
        file: 'data/assignments.csv',
        summary: 'Add 3 rows to data/assignments.csv',
        diff: {
          columns: ['student', 'question', 'topic', 'difficulty'],
          added: [
            ['maya', 'Q-212', 'ALG-2', 'medium'],
            ['maya', 'Q-219', 'ALG-2', 'medium'],
            ['maya', 'Q-231', 'ALG-2', 'hard'],
          ],
          removed: [],
          changed: [],
        },
        status: 'pending',
      },
    ],
    status: 'done',
  },
];
