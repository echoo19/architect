import type { Certificate, ReportCard, WorkspaceChat, WorkspaceMessage } from '@architect/shared';
import { FIELD_REPORT } from './fixtures-field';
import { AGENT } from './fixtures-workspace';
import { AT, storyReport } from './story';

/*
 * Certified answers (decision 077) as the stand-in engine serves them: Phil's certificate,
 * calibrated on 77 tasks of the academies it was taught on, 5 attempts each, with its bound
 * checked on the final test and on the two academies it never saw. The bounds are the exact
 * Clopper-Pearson bounds of these counts at δ = 0.05.
 */

const curve = [
  { votes: 5, answered: 44, errors: 0, coverage: 44 / 77, bound: 0.06581877114493428 },
  { votes: 4, answered: 60, errors: 1, coverage: 60 / 77, bound: 0.07663999493450335 },
  { votes: 3, answered: 68, errors: 6, coverage: 68 / 77, bound: 0.1667362135056183 },
  { votes: 2, answered: 74, errors: 9, coverage: 74 / 77, bound: 0.2026363689907087 },
  { votes: 1, answered: 77, errors: 11, coverage: 1, bound: 0.2253673604313673 },
];

const ASSUMPTION =
  'Requests like the calibration ones, drawn the same way from the organizations it was taught on, answered with a checked answer or file changes. An organization it never saw tests this assumption rather than inheriting the guarantee. A chat reply in words alone is given only when its attempts say the same thing, and the bound does not cover it.';

export const PHIL_CERTIFICATE: Certificate = {
  issued: true,
  n: 77,
  k: 5,
  delta: 0.05,
  epsilon: 0.1,
  curve,
  assumption: ASSUMPTION,
  threshold: curve[1] as (typeof curve)[number],
  checks: [
    { seen: true, synthetic: true, tasks: 72, answered: 55, errors: 2, held: true },
    {
      org: 'harbor',
      orgName: 'Harbor Learning',
      seen: false,
      synthetic: true,
      tasks: 36,
      answered: 26,
      errors: 1,
      held: true,
    },
    {
      org: 'cp',
      orgName: 'Real academy',
      seen: false,
      synthetic: false,
      tasks: 30,
      answered: 21,
      errors: 3,
      held: false,
    },
  ],
};

export const CERTIFIED_REPORT: ReportCard = { ...FIELD_REPORT, certificate: PHIL_CERTIFICATE };

/** The service desk's report, certified, for its chats in the personal edition. */
export const CERTIFIED_DESK_REPORT: ReportCard = { ...storyReport, certificate: PHIL_CERTIFICATE };

/** A certificate that couldn't be issued: too few calibration tasks for the target. */
export const UNCERTIFIED_REPORT: ReportCard = {
  ...FIELD_REPORT,
  certificate: {
    issued: false,
    n: 24,
    k: 5,
    delta: 0.05,
    epsilon: 0.1,
    curve: curve.map((point) => ({
      ...point,
      answered: Math.round((point.answered * 24) / 77),
      errors: 0,
      bound: 0.2,
    })),
    assumption: ASSUMPTION,
    reason: 'too_few',
    needed: 38,
  },
};

const attempt = (n: number, answer: string, agrees: boolean) => ({
  id: `att_${n}`,
  kind: 'attempt' as const,
  name: `Attempt ${n} of 5`,
  detail: answer,
  meta: agrees ? 'agrees' : 'differs',
  status: 'done' as const,
  ms: 3200 + n * 400,
});

export const HANDOFF_CHAT: WorkspaceChat = {
  id: 'cht_handoff',
  graduateId: AGENT.id,
  title: 'Refund for a late cancellation',
  createdAt: AT,
  updatedAt: '2026-10-27T16:40:00.000Z',
  running: false,
  waiting: false,
};

/** A request its attempts disagreed on, handed to a person, and one they agreed on. */
export const HANDOFF_MESSAGES: WorkspaceMessage[] = [
  {
    id: 'msg_handoff_1',
    chatId: HANDOFF_CHAT.id,
    role: 'user',
    createdAt: AT,
    text: 'Ana Ruiz cancelled her Thursday visit at 7 this morning. Does she get the trip fee back?',
    steps: [],
    blocks: [],
    status: 'done',
  },
  {
    id: 'msg_handoff_2',
    chatId: HANDOFF_CHAT.id,
    role: 'agent',
    createdAt: AT,
    text: "I'm not sure about this one: 2 of my 5 attempts gave the same answer, and I answer only when at least 4 do. Please hand it to a person.",
    steps: [
      attempt(1, '{"refund_cents":4500}', true),
      attempt(2, '{"refund_cents":0}', false),
      attempt(3, '{"refund_cents":4500}', true),
      attempt(4, '{"refund_cents":2250}', false),
      attempt(5, 'No answer', false),
    ],
    blocks: [],
    status: 'done',
    graduateVersion: 1,
  },
];
