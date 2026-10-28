import type {
  Attempt,
  FileDiff,
  GraduateSummary,
  Job,
  LineageEntry,
  Method,
  ReportCard,
  Round,
  Run,
  RunDetail,
  Trace,
  TypeResult,
} from '@architect/shared';

/*
 * One training story that every e2e fixture tells, so the numbers agree from screen to screen:
 * the sample job from DECISIONS.md 005, a service desk for Ferncliff Home Services, trained on a
 * hosted copy of the student and tested on this computer.
 *
 * Check tasks: 16 of 40 at the start. The job starts blank, so round 1 is Spark's first full
 * draft, kept as the starting point (26 of 40, decision 026). After it, a change that clears the
 * first check is checked again on new seeds and kept on both checks added up (decision 022), so
 * those rounds score out of 80: round 2 reverted (26 to 25), round 3 kept (26 to 32, then 52 to
 * 62 over both), round 4 kept (31 to 35, then 62 to 68), rounds 5 and 6 reverted, round 7 kept
 * (72 of 80, the 90% target). Seven rounds over 3 h 21 min cost $0.41 of Spark.
 * The final test: 55 of 60, and the bare baseline gets 24 of 60, the same 40% Glimmer scored on
 * the check tasks before any teaching.
 */

export const AT = '2026-10-27T15:00:00.000Z';
export const at = (minutes: number) => new Date(Date.parse(AT) + minutes * 60_000).toISOString();

export const STORY = {
  jobId: 'job_servicedesk',
  runId: 'run_servicedesk',
  graduateId: 'grd_servicedesk',
  seed: 7,
  /** The kept version the graduate ships with: seven candidates, the last one kept. */
  version: 8,
};

export const DESCRIPTION =
  'Close out the day for our home-services office: price the visits the technicians finished, ' +
  'find customers with overdue balances, and book the earliest technician for urgent calls.';

export const job: Job = {
  format: 1,
  id: STORY.jobId,
  name: 'Service desk',
  description: DESCRIPTION,
  summary: 'Prices finished jobs, finds overdue balances and books the next urgent call.',
  does: [
    'Prices a finished job from the rate card',
    'Finds overdue balances after partial payments',
    'Books the earliest technician with the right license',
    'Shows the line items behind every invoice',
  ],
  doesNot: [
    'Issues refunds or credits',
    'Changes prices or the rate card',
    'Guesses when the records disagree',
  ],
  createdAt: AT,
  taskTypes: [
    { id: 'invoice', label: 'Invoices', description: 'Price a finished job and add its invoice' },
    {
      id: 'overdue',
      label: 'Overdue balances',
      description: 'Find who owes money after partial payments',
    },
    {
      id: 'scheduling',
      label: 'Scheduling',
      description: 'Book the earliest technician who can do the job',
    },
  ],
  data: {
    files: [
      { name: 'jobs.csv', kind: 'table', access: 'read' },
      { name: 'invoices.csv', kind: 'table', access: 'write' },
      { name: 'technicians.csv', kind: 'table', access: 'read' },
      { name: 'bookings.csv', kind: 'table', access: 'write' },
      { name: 'policy.md', kind: 'text', access: 'read' },
    ],
    output: { description: 'Notes for the technicians.' },
  },
  permissions: { writes: 'ask', unseenFiles: 'ask' },
  checker: { kind: 'builtin' },
  requirements: { passRate: 0.9 },
  budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 240 },
  mentor: {
    kind: 'model',
    provider: 'meta',
    label: 'Muse Spark 1.3',
    baseUrl: 'https://api.meta.ai/v1',
    model: 'muse-spark-1.3',
    reasoningEffort: 'medium',
    secretRef: 'meta',
  },
  student: {
    label: 'Glimmer',
    local: {
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    },
    trainOn: 'local',
    hosted: {
      runtime: 'openai_compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta/muse-glimmer-30b',
      secretRef: 'openrouter',
      contextLength: 16_384,
    },
  },
  startingHarness: { kind: 'blank' },
  splits: { seed: STORY.seed, calibration: 10, train: 60, dev: 40, test: 60 },
  evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1, devRepeats: 1, patience: 4 },
};

/** The run as it was trained: on the hosted copy. */
export const trainedJob: Job = { ...job, student: { ...job.student, trainOn: 'hosted' } };

export function makeRun(overrides: Partial<Run>): Run {
  return {
    id: STORY.runId,
    jobId: STORY.jobId,
    method: 'architect',
    seed: STORY.seed,
    status: 'running',
    phase: 'evaluating',
    createdAt: AT,
    updatedAt: at(106),
    currentVersion: 4,
    devBaseline: { pass: 16, total: 40 },
    devCurrent: { pass: 62, total: 80 },
    totals: {
      mentorUsd: 0.23,
      mentorInputTokens: 112_000,
      mentorOutputTokens: 21_000,
      studentInputTokens: 1_900_000,
      studentOutputTokens: 210_000,
      rounds: 4,
      attempts: 492,
      wallMs: 106 * 60_000,
    },
    ...overrides,
  };
}

export function round(index: number, fields: Partial<Round>): Round {
  return {
    runId: STORY.runId,
    index,
    status: 'decided',
    train: { pass: 7, total: 12 },
    files: [],
    costUsd: 0.06,
    startedAt: at(index * 15),
    ...fields,
  };
}

export const rounds: Round[] = [
  round(1, {
    title: 'Work from the office files',
    draft: true,
    train: { pass: 0, total: 0 },
    diagnosis:
      'A first full setup from the job and its example tasks: read policy.md and the rate card ' +
      'before answering, a skill for pricing a finished job and one for booking urgent calls.',
    predicted: {
      devDeltaMin: 6,
      devDeltaMax: 12,
      rationale: 'The blank start misses most invoices and bookings.',
    },
    files: ['AGENTS.md', 'skills/book-urgent-calls/SKILL.md', 'skills/price-a-job/SKILL.md'],
    candidateVersion: 2,
    devBefore: { pass: 16, total: 40 },
    devAfter: { pass: 26, total: 40 },
    decision: 'kept',
    decisionReason:
      'Dev 16/40 → 26/40; the first draft is kept as the starting point, and later rounds keep ' +
      'only measured gains',
  }),
  round(2, {
    title: 'Filter tables before reading them',
    diagnosis: 'It reads whole tables a page at a time and runs out of steps on the larger files.',
    predicted: { devDeltaMin: 2, devDeltaMax: 4, rationale: 'Fewer wasted steps.' },
    files: ['AGENTS.md'],
    candidateVersion: 3,
    devBefore: { pass: 26, total: 40 },
    devAfter: { pass: 25, total: 40 },
    decision: 'reverted',
    decisionReason: 'Dev 26/40 → 25/40, down 1',
  }),
  round(3, {
    title: 'Cents, not dollars',
    diagnosis:
      'Totals drift by a cent or more because it rounds each line item as it goes. The ' +
      'policy says to work in integer cents and round once, at the end.',
    predicted: { devDeltaMin: 5, devDeltaMax: 9, rationale: 'Every invoice total depends on it.' },
    files: ['AGENTS.md', 'skills/price-a-job/SKILL.md'],
    candidateVersion: 4,
    devBefore: { pass: 52, total: 80 },
    devAfter: { pass: 62, total: 80 },
    firstMeasurement: { devBefore: { pass: 26, total: 40 }, devAfter: { pass: 32, total: 40 } },
    decision: 'kept',
    decisionReason:
      'Dev 26/40 → 32/40, measured again on new seeds: 52/80 → 62/80 over 2 runs, no type ' +
      'lost more than two',
  }),
  round(4, {
    status: 'evaluating',
    train: { pass: 8, total: 12 },
    title: 'Allow for zone travel time',
    diagnosis:
      'Bookings start too early: it ignores the drive between zones, so 3 of 4 scheduling ' +
      "failures pick a slot the technician can't reach in time.",
    predicted: { devDeltaMin: 3, devDeltaMax: 6, rationale: 'Scheduling is the weakest type.' },
    files: [
      'skills/book-urgent-calls/SKILL.md',
      'tools/travel_minutes.js',
      'tools/travel_minutes.json',
    ],
    candidateVersion: 5,
  }),
];

function attempt(
  id: string,
  fields: Partial<Attempt> & Pick<Attempt, 'taskType' | 'check'>,
  prompt: string,
): Attempt & { prompt: string } {
  return {
    id,
    runId: STORY.runId,
    round: 4,
    taskId: `task_${id}`,
    split: 'train',
    harnessVersion: 4,
    latencyMs: 13_200,
    usage: { inputTokens: 8_400, outputTokens: 380 },
    ...fields,
    prompt,
  };
}

export const failedBooking = attempt(
  'att_0412',
  {
    taskType: 'scheduling',
    check: {
      pass: false,
      reason:
        'Starts at 08:00, but Priya N. first has to drive 90 minutes from zone A to zone C, ' +
        'so the earliest start is 09:30.',
    },
    answerSummary: 'Wed 08:00, Priya N.',
    expectedSummary: 'Wed 09:30, Priya N.',
    latencyMs: 11_600,
  },
  'Book the earliest licensed electrician for an urgent panel repair at 14 Alder St, zone C.',
);

export const recentAttempts: (Attempt & { prompt: string })[] = [
  failedBooking,
  attempt(
    'att_0411',
    {
      taskType: 'invoice',
      check: { pass: true, reason: 'Line items and total match.' },
      answerSummary: '$486.20',
    },
    'Price finished job J-4410 and add its invoice.',
  ),
  attempt(
    'att_0410',
    {
      taskType: 'overdue',
      check: { pass: true, reason: 'Customers and amounts match.' },
      answerSummary: '3 customers, $2,915.00',
      latencyMs: 9_800,
    },
    'Which customers are more than 30 days overdue after partial payments?',
  ),
  attempt(
    'att_0409',
    {
      taskType: 'invoice',
      check: {
        pass: false,
        reason: 'Total is $1,248.50; expected $1,284.50. The after-hours rate applies to labor.',
      },
      answerSummary: '$1,248.50',
      expectedSummary: '$1,284.50',
      latencyMs: 16_100,
    },
    'Price finished job J-4412, an after-hours callout, and add its invoice.',
  ),
  attempt(
    'att_0398',
    {
      split: 'dev',
      round: 3,
      taskType: 'overdue',
      check: { pass: true, reason: 'Balance and date match.' },
      answerSummary: '$640.00, Aug 14',
      latencyMs: 10_400,
    },
    "What is Oakridge Dental's oldest unpaid balance?",
  ),
];

function lineage(
  source: Round,
  versionFrom: number,
  perType: LineageEntry['measured']['perType'],
): LineageEntry {
  const before = source.devBefore ?? { pass: 0, total: 40 };
  const after = source.devAfter ?? before;
  return {
    id: `lin_${source.index}`,
    runId: STORY.runId,
    round: source.index,
    title: source.title ?? '',
    diagnosis: source.diagnosis ?? '',
    files: source.files,
    causeTaskIds: ['task_att_0301', 'task_att_0305'],
    predicted: source.predicted ?? { devDeltaMin: 0, devDeltaMax: 0, rationale: '' },
    measured: {
      devBefore: before,
      devAfter: after,
      delta: after.pass - before.pass,
      perType,
      ...(source.firstMeasurement ? { firstMeasurement: source.firstMeasurement } : {}),
    },
    decision: source.decision ?? 'kept',
    decisionReason: source.decisionReason ?? '',
    versionFrom,
    versionTo: source.candidateVersion ?? source.index,
    mentor: { model: 'muse-spark-1.3', costUsd: 0.06, inputTokens: 28_000, outputTokens: 5_200 },
    at: at(source.index * 15 + 12),
  };
}

const [round1, round2, round3] = rounds as [Round, Round, Round, Round];

/** The run as the training screen first loads it: round 4's change is being scored. */
export const detail: RunDetail = {
  run: makeRun({}),
  job: trainedJob,
  rounds,
  recentAttempts,
  lineage: [
    lineage(round1, 1, [
      { type: 'invoice', before: 3, after: 10 },
      { type: 'overdue', before: 8, after: 10 },
      { type: 'scheduling', before: 5, after: 6 },
    ]),
    lineage(round2, 2, [
      { type: 'invoice', before: 10, after: 10 },
      { type: 'overdue', before: 10, after: 9 },
      { type: 'scheduling', before: 6, after: 6 },
    ]),
    lineage(round3, 2, [
      { type: 'invoice', before: 20, after: 28 },
      { type: 'overdue', before: 20, after: 22 },
      { type: 'scheduling', before: 12, after: 12 },
    ]),
  ],
};

export const trace: Trace = {
  taskId: failedBooking.taskId,
  harnessVersion: 4,
  studentModel: 'meta/muse-glimmer-30b',
  messages: [{ role: 'user', content: failedBooking.prompt }],
  steps: [
    { kind: 'skill', slug: 'book-urgent-calls', via: 'rule' },
    {
      kind: 'model',
      text: 'I need licensed electricians who can reach zone C, and their bookings for Wednesday.',
      toolCalls: [{ id: 'call_1', name: 'read', arguments: { path: 'data/technicians.csv' } }],
      usage: { inputTokens: 3_100, outputTokens: 96 },
      latencyMs: 2_400,
    },
    {
      kind: 'tool',
      callId: 'call_1',
      name: 'read',
      arguments: { path: 'data/technicians.csv' },
      result: [
        '1\tid,name,zone,license,hours',
        '2\tT-07,Priya N.,A,electrical,08:00-16:30',
        '3\tT-09,Ade O.,B,plumbing,07:30-16:00',
        '4\tT-11,Marcus O.,C,electrical,10:00-18:30',
      ].join('\n'),
      table: {
        columns: ['id', 'name', 'zone', 'license', 'hours'],
        rows: [
          ['T-07', 'Priya N.', 'A', 'electrical', '08:00-16:30'],
          ['T-09', 'Ade O.', 'B', 'plumbing', '07:30-16:00'],
          ['T-11', 'Marcus O.', 'C', 'electrical', '10:00-18:30'],
        ],
        total: 3,
      },
      latencyMs: 31,
    },
    {
      kind: 'model',
      text: '',
      toolCalls: [
        {
          id: 'call_2',
          name: 'grep',
          arguments: { pattern: ',T-(07|11),2026-10-28,', path: 'data/bookings.csv' },
        },
      ],
      usage: { inputTokens: 3_500, outputTokens: 64 },
      latencyMs: 1_800,
    },
    {
      kind: 'tool',
      callId: 'call_2',
      name: 'grep',
      arguments: { pattern: ',T-(07|11),2026-10-28,', path: 'data/bookings.csv' },
      result: 'data/bookings.csv:88: B-3040,T-07,2026-10-28,13:00,14:30,B',
      latencyMs: 28,
    },
    {
      kind: 'model',
      text: '',
      toolCalls: [
        {
          id: 'call_3',
          name: 'run',
          arguments: {
            code: [
              "const hours = { start: '08:00', end: '16:30' };",
              "const booked = { start: '13:00', end: '14:30' };",
              'hours.start < booked.start ? hours.start : booked.end',
            ].join('\n'),
          },
        },
      ],
      usage: { inputTokens: 3_700, outputTokens: 88 },
      latencyMs: 2_100,
    },
    {
      kind: 'tool',
      callId: 'call_3',
      name: 'run',
      arguments: {
        code: [
          "const hours = { start: '08:00', end: '16:30' };",
          "const booked = { start: '13:00', end: '14:30' };",
          'hours.start < booked.start ? hours.start : booked.end',
        ].join('\n'),
      },
      result: '=> "08:00"',
      latencyMs: 40,
    },
    {
      kind: 'model',
      text: 'Priya is free from 08:00 until 13:00, so the earliest start is 08:00.',
      toolCalls: [],
      usage: { inputTokens: 3_900, outputTokens: 141 },
      latencyMs: 3_100,
    },
  ],
  finalText:
    'Priya N. can take it first thing Wednesday.\nANSWER: {"technician":"T-07","start":"2026-10-28T08:00"}',
  stopReason: 'answer',
  usage: { inputTokens: 9_120, outputTokens: 412 },
  latencyMs: 11_600,
};

export const roundDiff: FileDiff[] = [
  {
    path: 'AGENTS.md',
    status: 'modified',
    patch: [
      '--- a/AGENTS.md',
      '+++ b/AGENTS.md',
      '@@ -4,4 +4,6 @@ You are the service desk for Ferncliff Home Services.',
      ' Read data/policy.md before you price a job, chase a balance or book a visit.',
      ' Work out every number with run; never estimate from memory.',
      '-Round each line item to the nearest cent as you go.',
      '+Work in integer cents from start to finish.',
      '+Add the lines, take off the plan-member discount, add the city tax,',
      '+and round once, at the end, half up.',
      ' Finish with one line: ANSWER: <json>.',
    ].join('\n'),
  },
  {
    path: 'skills/price-a-job/SKILL.md',
    status: 'modified',
    patch: [
      '--- a/skills/price-a-job/SKILL.md',
      '+++ b/skills/price-a-job/SKILL.md',
      '@@ -5,5 +5,6 @@ description: Price a finished job from the rate card.',
      ' 1. Read the job row from data/jobs.csv and the tier from data/technicians.csv.',
      '-2. Labor: hours times the tier rate, in dollars.',
      '+2. Labor: hours times the tier rate from policy.md, in cents.',
      ' 3. After hours (before 08:00, after 18:00, weekends): labor times 1.5.',
      '-4. Parts: cost times 1.35, rounded to the dollar.',
      '+4. Parts: cost times 1.35, rounded to the cent per part.',
      '+5. Keep every amount in cents until the total.',
    ].join('\n'),
  },
];

/** The graduate's final test, by task type. */
export const FINAL_TEST: TypeResult[] = [
  { type: 'invoice', label: 'Invoices', pass: 19, total: 20, refused: false },
  { type: 'overdue', label: 'Overdue balances', pass: 20, total: 20, refused: false },
  { type: 'scheduling', label: 'Scheduling', pass: 16, total: 20, refused: false },
];

const REFUSED = [
  {
    type: 'refunds',
    label: 'Refunds',
    reason: "Its job says it won't issue refunds or credits, so it leaves them to you.",
  },
];

function report(
  runId: string,
  method: Method,
  pass: number,
  cost: { mentorUsd: number; studentUsd?: number; rounds: number; wallMs: number },
): ReportCard {
  const scale = pass / 55;
  const actual = pass / 60;
  return {
    jobId: STORY.jobId,
    runId,
    method,
    name: 'Service desk',
    createdAt: at(180),
    student: { label: 'Glimmer', model: 'muse-glimmer:30b', runtime: 'ollama' },
    testedOn: 'local',
    mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
    test: {
      score: { pass, total: 60 },
      perType: FINAL_TEST.map((type) => ({
        ...type,
        pass: method === 'architect' ? type.pass : Math.round(type.pass * scale),
      })),
      latencyMs: { p50: 150_000, p95: 222_000 },
      refusals: 0,
      ranOffline: true,
    },
    dev: {
      baseline: { pass: 16, total: 40 },
      final: { pass: 72, total: 80 },
      curve: [
        { round: 0, score: { pass: 16, total: 40 }, decision: 'baseline' },
        { round: 1, score: { pass: 26, total: 40 }, decision: 'kept' },
        { round: 2, score: { pass: 25, total: 40 }, decision: 'reverted' },
        { round: 3, score: { pass: 62, total: 80 }, decision: 'kept' },
        { round: 4, score: { pass: 68, total: 80 }, decision: 'kept' },
        { round: 5, score: { pass: 33, total: 40 }, decision: 'reverted' },
        { round: 6, score: { pass: 35, total: 40 }, decision: 'reverted' },
        { round: 7, score: { pass: 72, total: 80 }, decision: 'kept' },
      ],
    },
    cost: {
      mentorUsd: cost.mentorUsd,
      mentorInputTokens: 196_000,
      mentorOutputTokens: 36_400,
      rounds: cost.rounds,
      wallMs: cost.wallMs,
      ...(cost.studentUsd === undefined ? {} : { studentUsd: cost.studentUsd }),
    },
    refusedTypes: method === 'architect' ? REFUSED : [],
    topInterventions:
      method === 'architect'
        ? [
            { round: 1, title: 'Work from the office files', delta: 10 },
            { round: 3, title: 'Cents, not dollars', delta: 10, runs: 2 },
            { round: 4, title: 'Allow for zone travel time', delta: 6, runs: 2 },
          ]
        : [],
    requirements: { passRate: { target: 0.9, actual, met: actual >= 0.9 } },
    overclaim: false,
  };
}

/** The report card of the run, and of the three baselines trained beside it on the same seed. */
export const reports: Record<string, ReportCard> = {
  [STORY.runId]: report(STORY.runId, 'architect', 55, {
    mentorUsd: 0.41,
    studentUsd: 3.2,
    rounds: 7,
    wallMs: 201 * 60_000,
  }),
  run_bare: report('run_bare', 'bare', 24, { mentorUsd: 0, rounds: 0, wallMs: 41 * 60_000 }),
  run_oneshot: report('run_oneshot', 'one_shot', 42, {
    studentUsd: 0.4,
    mentorUsd: 0.04,
    rounds: 1,
    wallMs: 52 * 60_000,
  }),
  run_reflect: report('run_reflect', 'self_reflection', 38, {
    studentUsd: 2.9,
    mentorUsd: 0,
    rounds: 7,
    wallMs: 149 * 60_000,
  }),
};

export const storyReport = reports[STORY.runId] as ReportCard;

export const graduate: GraduateSummary = {
  id: STORY.graduateId,
  name: 'Service desk',
  path: 'graduates/service-desk',
  manifest: {
    format: 1,
    id: STORY.graduateId,
    name: 'Service desk',
    jobId: STORY.jobId,
    runId: STORY.runId,
    method: 'architect',
    createdAt: at(180),
    acceptedAt: at(181),
    student: {
      label: 'Glimmer',
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b',
      quantization: 'Q4_K_M',
      sizeBytes: 18 * 1024 ** 3,
      contextLength: 16_384,
    },
    harness: { version: STORY.version, round: 7, hash: 'sha256-story' },
    requirements: { passRate: { target: 0.9, actual: 55 / 60, met: true } },
    test: { score: { pass: 55, total: 60 }, perType: FINAL_TEST },
    mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
  },
  activeVersion: 1,
  versions: 1,
  status: 'ready',
  reasons: [],
};
