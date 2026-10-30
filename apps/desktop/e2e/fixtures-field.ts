import type {
  CapabilityBreakdown,
  GraduateSummary,
  Job,
  OrgTypeResult,
  ReportCard,
  TypeResult,
  WorkspaceChat,
  WorkspaceMessage,
} from '@architect/shared';
import { AT, graduate, storyReport, trainedJob } from './story';

/*
 * Phil, the academy tutor of the field plan, as a report and an agent: one specialist trained
 * with three synthetic academies and tested also on one it never saw and on a real one it never
 * saw (decisions 068 and 070). The real one has no question text, so only some skills are tested
 * there.
 */

const SKILLS = [
  { id: 'diagnose', label: 'Diagnose a wrong answer' },
  { id: 'solve', label: 'Work the question' },
  { id: 'hint', label: 'First hint' },
  { id: 'history', label: 'Topic history' },
  { id: 'assign', label: 'Assign practice' },
  { id: 'after_wrong', label: 'Whole tutoring turn' },
] as const;

type Skill = (typeof SKILLS)[number]['id'];

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
    name: 'CP Admissions',
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

export const FIELD_JOB: Job = {
  ...trainedJob,
  name: 'Phil',
  summary: 'Helps a student right after a wrong answer, from the academy’s own curriculum.',
  does: [],
  doesNot: ['Changes a grade or a recorded score'],
  taskTypes: SKILLS.map((skill) => ({ id: skill.id, label: skill.label, description: '' })),
};

export const FIELD_REPORT: ReportCard = {
  ...storyReport,
  name: 'Phil',
  refusedTypes: [],
  topInterventions: [],
  test: {
    ...storyReport.test,
    score: SCORE,
    perType: PER_TYPE,
    perOrg: PER_ORG,
    refusals: 0,
  },
  requirements: {
    passRate: { target: 0.9, actual: SCORE.pass / SCORE.total, met: true },
  },
  overclaim: null,
};

export const FIELD_CAPABILITIES: CapabilityBreakdown = {
  runId: storyReport.runId,
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
  name: 'Phil',
  manifest: {
    ...graduate.manifest,
    name: 'Phil',
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
