import type {
  AgentBlock,
  AgentStep,
  GraduateSummary,
  WorkspaceChat,
  WorkspaceMessage,
} from '@architect/shared';

/*
 * A few weeks of an agent's work, for its home: sessions with requests, replies, the tools each
 * reply called, the writes the person allowed or declined, the requests it left to a person and
 * the odd reply that stopped on an error. Every agent's sessions are about its own records, in
 * the words its other fixtures use. The times are laid out from when the agent's version was
 * accepted up to now, so a world started on any day shows its activity ending today.
 */

type StepSpec = readonly [name: string, detail: string, meta?: string];

interface Exchange {
  ask: string;
  answer: string;
  /** From the request to the reply's last word. */
  seconds: number;
  steps: readonly StepSpec[];
  write?: { file: string; summary: string; status: 'approved' | 'denied' };
  refusal?: { taskType: string; reason: string };
  /** The reply stopped on this error instead of answering. */
  error?: string;
}

interface SessionPlan {
  id: string;
  title: string;
  /** Where the session falls between the version's acceptance and now, from 0 to 1. */
  at: number;
  /** The hour of the day it starts, on this computer's clock. */
  hour: number;
  exchanges: readonly Exchange[];
}

export interface AgentActivity {
  graduateId: string;
  /** The version that answered every reply. */
  version: number;
  /** When that version was accepted: no session is older. */
  since: string;
  sessions: readonly SessionPlan[];
}

const GPU_BUSY =
  'The GPU is busy: Architect is checking an agent on this computer. Try again in a moment.';

const ex = (
  ask: string,
  answer: string,
  seconds: number,
  steps: readonly StepSpec[],
  extra: Partial<Exchange> = {},
): Exchange => ({ ask, answer, seconds, steps, ...extra });

/* Service desk: a home-services company's jobs, invoices, bookings and technicians. */
const SERVICE_DESK: readonly SessionPlan[] = [
  {
    id: 'svc_open_sept',
    title: 'Open balances from September',
    at: 0.02,
    hour: 8.6,
    exchanges: [
      ex(
        'Which September invoices are still open?',
        'Three are open, $2,915.00 in all: INV-3018 (Okafor, $1,180.00), INV-3024 (Brennan, $965.00) and INV-3051 (Achebe, $770.00).',
        11.4,
        [
          ['read', 'data/policy.md', '66 lines'],
          ['run', 'data/invoices.csv', '3 rows'],
        ],
      ),
      ex(
        'Draft a reminder for Okafor.',
        'Drafted: a short reminder that INV-3018 for $1,180.00 was due Sep 18, with the payment link line from the policy.',
        7.9,
        [['read', 'data/customers.csv', 'rows 1-40 of 212']],
      ),
    ],
  },
  {
    id: 'svc_price_4462',
    title: 'Price J-4462 and J-4464',
    at: 0.1,
    hour: 10.2,
    exchanges: [
      ex(
        'Price the two jobs Tomas finished this morning.',
        'J-4462 comes to $318.40 and J-4464 to $611.75. J-4464 included a part from the van stock, billed at list.',
        14.8,
        [
          ['grep', '/T-07/ in data/jobs.csv', '2 matches'],
          ['run', 'data/technicians.csv', '1 row'],
          ['invoice_total', 'job J-4462', '$318.40'],
          ['invoice_total', 'job J-4464', '$611.75'],
        ],
      ),
      ex(
        'Invoice both.',
        'Both invoices are saved as INV-4462 and INV-4464.',
        6.2,
        [['append', 'data/invoices.csv', '2 rows']],
        {
          write: {
            file: 'data/invoices.csv',
            summary: 'Add 2 rows to data/invoices.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'svc_book_elm',
    title: 'Book the Elm St water heater',
    at: 0.22,
    hour: 13.4,
    exchanges: [
      ex(
        'Book the water heater swap at 14 Elm St for Friday.',
        'Dana R. has Friday 9:00 free and is in zone B, 12 minutes from Elm St. The booking is B-3044.',
        12.6,
        [
          ['grep', '/2026-10-30/ in data/bookings.csv', '4 matches'],
          ['travel_minutes', 'zone B to zone B', '12 min'],
          ['append', 'data/bookings.csv', '1 row'],
        ],
        {
          write: {
            file: 'data/bookings.csv',
            summary: 'Add 1 row to data/bookings.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'svc_refund_fee',
    title: 'Waive the Lindqvist trip fee',
    at: 0.31,
    hour: 9.1,
    exchanges: [
      ex('Waive the $35 trip fee on J-4440 for Lindqvist.', '', 1.9, [], {
        refusal: {
          taskType: 'refunds',
          reason: "Its job says it won't issue refunds or credits, so it leaves them to you.",
        },
      }),
    ],
  },
  {
    id: 'svc_after_hours',
    title: 'After-hours jobs this week',
    at: 0.43,
    hour: 16.8,
    exchanges: [
      ex(
        'How many after-hours jobs did we run this week?',
        'Five, all in zones B and C. Three were Dana R.’s; together they billed $3,412.80 of labor at 1.5x.',
        9.7,
        [['run', 'data/jobs.csv', '5 rows']],
      ),
      ex('Which ones are not invoiced yet?', 'J-4451 and J-4457. Both finished on Tuesday.', 5.4, [
        ['grep', '/J-445[17]/ in data/invoices.csv', 'no matches'],
      ]),
      ex(
        'Invoice them.',
        '',
        18.3,
        [
          ['invoice_total', 'job J-4451', '$842.10'],
          ['invoice_total', 'job J-4457', '$1,204.00'],
        ],
        { error: GPU_BUSY },
      ),
      ex(
        'Try that again.',
        'J-4451 comes to $842.10 and J-4457 to $1,204.00; both are saved as invoices.',
        13.1,
        [
          ['invoice_total', 'job J-4451', '$842.10'],
          ['invoice_total', 'job J-4457', '$1,204.00'],
          ['append', 'data/invoices.csv', '2 rows'],
        ],
        {
          write: {
            file: 'data/invoices.csv',
            summary: 'Add 2 rows to data/invoices.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'svc_reschedule',
    title: 'Move the Varga inspection',
    at: 0.57,
    hour: 11.3,
    exchanges: [
      ex(
        'Move the Varga panel inspection to next Tuesday afternoon.',
        'Marcus O. is free Tuesday at 14:00. I can move B-3038 there; it keeps its 90 minutes.',
        10.8,
        [
          ['grep', '/B-3038/ in data/bookings.csv', '1 match'],
          ['grep', '/2026-11-03/ in data/bookings.csv', '3 matches'],
          ['edit', 'data/bookings.csv', '1 row'],
        ],
        {
          write: {
            file: 'data/bookings.csv',
            summary: 'Change 1 row of data/bookings.csv',
            status: 'denied',
          },
        },
      ),
      ex(
        'Leave it for now, the customer will call back.',
        'Left as it is: B-3038 stays on Thursday at 10:00.',
        3.1,
        [],
      ),
    ],
  },
  {
    id: 'svc_parts',
    title: 'Parts used on J-4459',
    at: 0.68,
    hour: 15.2,
    exchanges: [
      ex(
        'What parts went into J-4459?',
        'A 40 gal anode rod and two dielectric unions, $86.40 at list, all from van 3.',
        6.8,
        [['grep', '/J-4459/ in data/job_parts.csv', '3 matches']],
      ),
    ],
  },
  {
    id: 'svc_weekly',
    title: 'Revenue by technician',
    at: 0.81,
    hour: 17.4,
    exchanges: [
      ex(
        'Revenue by technician for the last seven days.',
        'Dana R. $6,214.30, Marcus O. $4,880.15, Tomas K. $3,102.60 and Priya S. $2,455.00, $16,652.05 in all.',
        16.2,
        [
          ['run', 'data/invoices.csv', '4 rows'],
          ['read', 'data/technicians.csv', '11 rows'],
        ],
      ),
      ex('And how many jobs each?', 'Dana R. 14, Marcus O. 11, Tomas K. 8 and Priya S. 7.', 4.6, [
        ['run', 'data/jobs.csv', '4 rows'],
      ]),
    ],
  },
  {
    id: 'svc_okafor_paid',
    title: 'Did Okafor pay?',
    at: 1,
    hour: 9.4,
    exchanges: [
      ex('Did Okafor pay INV-3018 yet?', 'Yes, in full on Oct 29, by card.', 4.2, [
        ['grep', '/INV-3018/ in data/payments.csv', '1 match'],
      ]),
    ],
  },
];

/* Academy desk: a test-prep academy's students, attempts, hints and assignments. */
const ACADEMY_DESK: readonly SessionPlan[] = [
  {
    id: 'acd_leo_geo',
    title: 'Leo keeps missing GEO-3',
    at: 0.03,
    hour: 15.6,
    exchanges: [
      ex(
        'Leo has missed three GEO-3 questions this week. What is going on?',
        'Each time he used the diameter where the formula needs the radius (topic GEO-3, rule 2). His last eight attempts on other topics are fine.',
        13.9,
        [
          ['read', 'data/policy.md', '48 lines'],
          ['grep', '/leo/ in data/attempts.csv', '26 matches'],
          ['grep', '/GEO-3/ in data/errors.csv', '4 matches'],
        ],
      ),
      ex(
        'Give him practice on it.',
        'Three GEO-3 questions in his band are queued for him: Q-118, Q-124 and Q-131.',
        8.7,
        [
          ['grep', '/GEO-3/ in data/questions.csv', '19 matches'],
          ['append', 'data/assignments.csv', '3 rows'],
        ],
        {
          write: {
            file: 'data/assignments.csv',
            summary: 'Add 3 rows to data/assignments.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'acd_hint_q77',
    title: 'A hint for question 77',
    at: 0.12,
    hour: 16.4,
    exchanges: [
      ex(
        'Priya is stuck on Q-77. What first hint should I give?',
        'Ask her: "What do the two triangles share?" The policy keeps the first hint to a question, never the next step.',
        6.3,
        [
          ['read', 'data/hints.csv', 'rows 1-60 of 412'],
          ['grep', '/Q-77/ in data/questions.csv', '1 match'],
        ],
      ),
    ],
  },
  {
    id: 'acd_history_sam',
    title: "Sam's last two weeks",
    at: 0.21,
    hour: 10.8,
    exchanges: [
      ex(
        "Summarize Sam's last two weeks for his parents' meeting.",
        '41 questions, 30 right (73%). He improved most on ALG-1; RAT-2 is still his weakest topic, at 4 of 9.',
        15.7,
        [
          ['grep', '/sam/ in data/attempts.csv', '41 matches'],
          ['run', 'data/attempts.csv', '6 rows'],
          ['read', 'data/staff_notes.csv', '3 rows'],
        ],
      ),
    ],
  },
  {
    id: 'acd_diagnose_ana',
    title: 'Why did Ana pick C?',
    at: 0.33,
    hour: 14.2,
    exchanges: [
      ex(
        'Ana chose C on Q-203. Why?',
        'C is what you get by adding the percentages instead of compounding them (topic PCT-2, rule 3).',
        7.4,
        [
          ['grep', '/Q-203/ in data/questions.csv', '1 match'],
          ['grep', '/PCT-2/ in data/errors.csv', '3 matches'],
        ],
      ),
      ex(
        'Is that a pattern for her?',
        'Yes: two of her last three PCT-2 misses are the same slip.',
        5.1,
        [['grep', '/ana/ in data/attempts.csv', '33 matches']],
      ),
    ],
  },
  {
    id: 'acd_refund',
    title: "Refund Omar's October fee",
    at: 0.45,
    hour: 9.3,
    exchanges: [
      ex('Refund the October fee for Omar.', '', 1.6, [], {
        refusal: {
          taskType: 'billing',
          reason:
            "Its job leaves fees and refunds to the academy's office, so it hands this to you.",
        },
      }),
    ],
  },
  {
    id: 'acd_assign_batch',
    title: 'Practice for the Thursday group',
    at: 0.56,
    hour: 17.1,
    exchanges: [
      ex(
        'Queue practice for the Thursday group on what they missed most.',
        'Their most missed topic is ALG-2. I can queue two ALG-2 questions in each student’s band, 12 rows for 6 students.',
        19.6,
        [
          ['read', 'data/students.csv', '38 rows'],
          ['run', 'data/attempts.csv', '6 rows'],
          ['grep', '/ALG-2/ in data/questions.csv', '24 matches'],
          ['append', 'data/assignments.csv', '12 rows'],
        ],
        {
          write: {
            file: 'data/assignments.csv',
            summary: 'Add 12 rows to data/assignments.csv',
            status: 'denied',
          },
        },
      ),
      ex(
        'Just one each, they have a test Friday.',
        'Queued one ALG-2 question for each of the six, in their bands.',
        9.2,
        [['append', 'data/assignments.csv', '6 rows']],
        {
          write: {
            file: 'data/assignments.csv',
            summary: 'Add 6 rows to data/assignments.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'acd_solve',
    title: 'Work through Q-152',
    at: 0.69,
    hour: 11.9,
    exchanges: [
      ex(
        'Work through Q-152 the way we teach it.',
        'Set the two expressions equal, move the x terms left: 3x − x = 14 − 4, so x = 5. The answer is B.',
        8.1,
        [['grep', '/Q-152/ in data/questions.csv', '1 match']],
      ),
      ex(
        'Thanks. Anyone else miss it this week?',
        'Two others: Leo and Mina, both with A.',
        13.4,
        [['grep', '/Q-152/ in data/attempts.csv', '9 matches']],
        { error: GPU_BUSY },
      ),
      ex(
        'Anyone else miss Q-152 this week?',
        'Two others: Leo and Mina, both chose A, which drops the minus sign.',
        6.6,
        [['grep', '/Q-152/ in data/attempts.csv', '9 matches']],
      ),
    ],
  },
  {
    id: 'acd_after_wrong',
    title: 'Next step for Jun',
    at: 1,
    hour: 16.1,
    exchanges: [
      ex(
        'Jun got Q-61 wrong again. What next?',
        'Per the policy, after a second miss on one question: a worked example first, then two easier RAT-1 questions. I can queue them.',
        10.4,
        [
          ['read', 'data/policy.md', '48 lines'],
          ['grep', '/jun/ in data/attempts.csv', '17 matches'],
        ],
      ),
      ex(
        'Yes please.',
        'Queued: the worked example for Q-61, then Q-44 and Q-49.',
        5.8,
        [['append', 'data/assignments.csv', '3 rows']],
        {
          write: {
            file: 'data/assignments.csv',
            summary: 'Add 3 rows to data/assignments.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
];

/* Assay desk: Fenwick Screening Core's plates, reads and re-tests. */
const ASSAY_DESK: readonly SessionPlan[] = [
  {
    id: 'asy_qc_0412',
    title: 'Does FW-0412 pass QC?',
    at: 0.05,
    hour: 9.2,
    exchanges: [
      ex(
        'Does plate FW-0412 pass QC?',
        "Yes. Z′ is 0.71, above Fenwick's 0.5, and both control columns are within range.",
        12.2,
        [
          ['read', 'data/policy.md', '52 lines'],
          ['grep', '/FW-0412/ in data/kestrel_export.csv', '384 matches'],
          ['run', 'data/kestrel_export.csv', '1 row'],
        ],
      ),
    ],
  },
  {
    id: 'asy_hits_0413',
    title: 'Hits on FW-0413',
    at: 0.16,
    hour: 10.7,
    exchanges: [
      ex(
        'List the hits on FW-0413.',
        'Four hits above 50% inhibition: FWC-10027, FWC-10042, FWC-10051 and FWC-10066.',
        17.3,
        [
          ['grep', '/FW-0413/ in data/kestrel_export.csv', '96 matches'],
          ['run', 'data/compounds.csv', '4 rows'],
        ],
      ),
      ex(
        'Any replicates that disagree?',
        'FWC-10051: its two wells read 62% and 31%, so it counts as inconclusive under the policy.',
        8.9,
        [['run', 'data/kestrel_export.csv', '2 rows']],
      ),
    ],
  },
  {
    id: 'asy_retest_0414',
    title: "Queue FW-0414's re-tests",
    at: 0.29,
    hour: 14.6,
    exchanges: [
      ex(
        "Queue FW-0414's re-tests.",
        'Two compounds need one: FWC-10088 is borderline and FWC-10093 inconclusive. They are queued as RT-0011 and RT-0012.',
        15.4,
        [
          ['grep', '/FW-0414/ in data/lumen_export.csv', '96 matches'],
          ['run', 'data/lumen_export.csv', '2 rows'],
          ['append', 'data/retests.csv', '2 rows'],
        ],
        {
          write: {
            file: 'data/retests.csv',
            summary: 'Add 2 rows to data/retests.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'asy_normalize',
    title: 'Normalize the Lumen reads',
    at: 0.47,
    hour: 11.5,
    exchanges: [
      ex(
        'Normalize the Lumen 3 reads from Thursday against their controls.',
        'Done for plates FW-0415 and FW-0416: percent inhibition against each plate’s DMSO and positive control means.',
        21.8,
        [
          ['read', 'data/plates.csv', '18 rows'],
          ['run', 'data/lumen_export.csv', '192 rows'],
        ],
      ),
    ],
  },
  {
    id: 'asy_report_0416',
    title: 'Write up FW-0416',
    at: 0.63,
    hour: 16.2,
    exchanges: [
      ex(
        'Write up plate FW-0416.',
        'FW-0416 passes QC (Z′ 0.64) with two hits, FWC-10102 and FWC-10117. One re-test is needed for FWC-10109, borderline.',
        19.1,
        [
          ['grep', '/FW-0416/ in data/lumen_export.csv', '96 matches'],
          ['run', 'data/lumen_export.csv', '3 rows'],
          ['read', 'data/retests.csv', '14 rows'],
        ],
      ),
      ex('Queue that re-test.', '', 9.8, [], { error: GPU_BUSY }),
    ],
  },
  {
    id: 'asy_compound_hist',
    title: 'History of FWC-10066',
    at: 1,
    hour: 10.1,
    exchanges: [
      ex(
        'Has FWC-10066 been re-tested before?',
        'Once: RT-0004 on Oct 7, for an inconclusive read on FW-0411. Its re-test read 58%, a hit.',
        6.9,
        [['grep', '/FWC-10066/ in data/retests.csv', '1 match']],
      ),
    ],
  },
];

/* Inventory desk: Fenwick's compound stock, lots and reservations. */
const INVENTORY_DESK: readonly SessionPlan[] = [
  {
    id: 'inv_usable_10009',
    title: 'Usable stock of FWC-10009',
    at: 0.06,
    hour: 9.6,
    exchanges: [
      ex(
        'How much usable FWC-10009 do we have?',
        'Two lots, 288.5 µL in all: FL-02303 (89 µL at 5 mM, rack VR-02:E02) and FL-02304 (199.5 µL at 10 mM, VR-04:D08). Neither expires before 2027.',
        8.4,
        [
          ['read', 'data/policy.md', '40 lines'],
          ['grep', '/FWC-10009/ in data/inventory.csv', '2 matches'],
        ],
      ),
    ],
  },
  {
    id: 'inv_pick_10006',
    title: 'Which lot for FWC-10006?',
    at: 0.2,
    hour: 13.2,
    exchanges: [
      ex(
        'Which lot should the FWC-10006 re-test draw from?',
        'FL-02302 in VR-04:F12: the only lot, 167.5 µL free, expiring Jan 30, 2028.',
        5.9,
        [['grep', '/FWC-10006/ in data/inventory.csv', '1 match']],
      ),
    ],
  },
  {
    id: 'inv_reserve_0414',
    title: "Hold stock for FW-0414's re-tests",
    at: 0.36,
    hour: 15.1,
    exchanges: [
      ex(
        "Hold stock for FW-0414's re-tests.",
        'Both are held: 20 µL of FWC-10088 from FL-02341 and 20 µL of FWC-10093 from FL-02355, as RS-0031 and RS-0032.',
        18.6,
        [
          ['read', 'data/policy.md', '40 lines'],
          ['grep', '/FWC-100(88|93)/ in data/inventory.csv', '3 matches'],
          ['append', 'data/reservations.csv', '2 rows'],
        ],
        {
          write: {
            file: 'data/reservations.csv',
            summary: 'Add 2 rows to data/reservations.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'inv_expiring',
    title: 'Lots expiring this quarter',
    at: 0.52,
    hour: 10.4,
    exchanges: [
      ex(
        'Which lots expire before the end of the year?',
        'Three: FL-02288 (FWC-10021) on Nov 19, FL-02297 (FWC-10044) on Dec 2 and FL-02310 (FWC-10075) on Dec 21.',
        11.2,
        [['run', 'data/inventory.csv', '3 rows']],
      ),
      ex('Release the hold on FL-02288, that re-test was cancelled.', '', 1.8, [], {
        refusal: {
          taskType: 'release',
          reason: "Its job only places holds; releasing one is left to the lab's stock manager.",
        },
      }),
    ],
  },
  {
    id: 'inv_allocate',
    title: 'Split FWC-10003 across two runs',
    at: 0.71,
    hour: 14.8,
    exchanges: [
      ex(
        'We need 120 µL of FWC-10003 for each of two runs. Can one lot cover both?',
        "Yes: FL-02301 has 199.5 µL free, but two runs need 240 µL, so the second run can't be covered. Fenwick doesn't combine lots.",
        9.5,
        [
          ['grep', '/FWC-10003/ in data/inventory.csv', '1 match'],
          ['grep', '/FL-02301/ in data/reservations.csv', 'no matches'],
        ],
      ),
    ],
  },
  {
    id: 'inv_reserve_0416',
    title: 'Hold stock for FWC-10109',
    at: 1,
    hour: 11.1,
    exchanges: [
      ex(
        "Hold stock for FWC-10109's re-test.",
        "20 µL from FL-02372, rack VR-08:B04, held as RS-0035. It's the earliest of its usable lots to expire.",
        12.7,
        [
          ['grep', '/FWC-10109/ in data/inventory.csv', '2 matches'],
          ['append', 'data/reservations.csv', '1 row'],
        ],
        {
          write: {
            file: 'data/reservations.csv',
            summary: 'Add 1 row to data/reservations.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
];

/* Returns desk: an outdoor-gear shop's orders, returns and pickups. */
const RETURNS_DESK_SESSIONS: readonly SessionPlan[] = [
  {
    id: 'ret_galloway',
    title: 'Return for Vera Galloway',
    at: 0.04,
    hour: 10.3,
    exchanges: [
      ex(
        'Vera Galloway brought back the Titanium Pot Set from ORD-10289, opened. Process it.',
        'Approved: opened kitchen items are taken back within 30 days with a 15% restocking fee, so $71.37 goes back to her card.',
        12.9,
        [
          ['read', 'data/policy.md', '58 lines'],
          ['grep', '/ORD-10289/ in data/order_lines.csv', '2 matches'],
          ['append', 'data/returns.csv', '1 row'],
        ],
        {
          write: {
            file: 'data/returns.csv',
            summary: 'Add 1 row to data/returns.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'ret_canister',
    title: 'Fuel canisters from ORD-10301',
    at: 0.17,
    hour: 14.7,
    exchanges: [
      ex(
        'Can we take back the two fuel canisters on ORD-10301?',
        'No. Fuel canisters are final sale, so the return is denied and nothing is refunded.',
        5.6,
        [
          ['grep', '/AK-2241/ in data/products.csv', '1 match'],
          ['read', 'data/policy.md', '58 lines'],
        ],
      ),
    ],
  },
  {
    id: 'ret_pickup_duffel',
    title: 'Pickup for the rolling duffel',
    at: 0.32,
    hour: 11.6,
    exchanges: [
      ex(
        'Book a pickup for the duffel on RT-5004.',
        'Booked with Kettlepoint Courier for Thursday, as PU-5004. The duffel is bulky, so Cedarline doesn’t take it.',
        9.9,
        [
          ['grep', '/RT-5004/ in data/returns.csv', '1 match'],
          ['append', 'data/pickups.csv', '1 row'],
        ],
        {
          write: {
            file: 'data/pickups.csv',
            summary: 'Add 1 row to data/pickups.csv',
            status: 'approved',
          },
        },
      ),
    ],
  },
  {
    id: 'ret_order_status',
    title: 'Where is ORD-10342?',
    at: 0.48,
    hour: 9.8,
    exchanges: [
      ex('Where is order ORD-10342?', 'Shipped on Nov 26 and delivered on Nov 29.', 3.9, [
        ['grep', '/ORD-10342/ in data/orders.csv', '1 match'],
      ]),
      ex('Refund the shipping on it, the customer is unhappy.', '', 1.7, [], {
        refusal: {
          taskType: 'goodwill',
          reason:
            'Its job only refunds what the return policy covers, so goodwill refunds are yours.',
        },
      }),
    ],
  },
  {
    id: 'ret_late_return',
    title: 'Late return of a tent',
    at: 0.66,
    hour: 15.9,
    exchanges: [
      ex(
        'A customer wants to return a tent from ORD-10188, delivered 41 days ago, unopened.',
        "Denied: the window is 30 days from delivery, and it's past that.",
        7.2,
        [
          ['grep', '/ORD-10188/ in data/orders.csv', '1 match'],
          ['read', 'data/policy.md', '58 lines'],
        ],
      ),
      ex('Record it anyway so we have it.', '', 8.1, [], { error: GPU_BUSY }),
    ],
  },
  {
    id: 'ret_weekly',
    title: 'Returns this week',
    at: 1,
    hour: 17.2,
    exchanges: [
      ex(
        'How many returns did we approve this week, and how much went back?',
        'Seven approved and two denied; $612.48 went back, $540.11 to cards and $72.37 as store credit.',
        11.8,
        [['run', 'data/returns.csv', '9 rows']],
      ),
    ],
  },
];

export const ACTIVITY_PLANS = {
  serviceDesk: SERVICE_DESK,
  academyDesk: ACADEMY_DESK,
  assayDesk: ASSAY_DESK,
  inventoryDesk: INVENTORY_DESK,
  returnsDesk: RETURNS_DESK_SESSIONS,
};

/** An agent's activity: its sessions, answered by its active version since it was accepted. */
export function activityOf(
  agent: Pick<GraduateSummary, 'id' | 'activeVersion' | 'manifest'>,
  sessions: readonly SessionPlan[],
): AgentActivity {
  return {
    graduateId: agent.id,
    version: agent.activeVersion ?? 1,
    since: agent.manifest.acceptedAt ?? agent.manifest.createdAt,
    sessions,
  };
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * The span the sessions are laid out on: from just after the acceptance to now, at most 13 days.
 * A version accepted moments ago, or later than this computer's clock, gets three days ahead.
 */
function spanOf(since: string, now: Date): { start: number; end: number; days: number } {
  const accepted = Date.parse(since) + 60 * MINUTE;
  const end = Math.max(now.getTime() - 20 * MINUTE, accepted + 3 * DAY);
  const start = Math.max(accepted, end - 13 * DAY);
  return { start, end, days: Math.floor((end - start) / DAY) };
}

function stepsOf(specs: readonly StepSpec[], prefix: string): AgentStep[] {
  return specs.map(([name, detail, meta], index) => ({
    id: `${prefix}_s${index + 1}`,
    kind: 'tool',
    name,
    detail,
    ...(meta === undefined ? {} : { meta }),
    status: 'done',
    ms: 180 + ((index * 137) % 900),
  }));
}

function blocksOf(exchange: Exchange, prefix: string): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  if (exchange.write) {
    blocks.push({
      kind: 'approval',
      changeId: `${prefix}_chg`,
      op: exchange.write.summary.startsWith('Change') ? 'edit' : 'append',
      file: exchange.write.file,
      summary: exchange.write.summary,
      status: exchange.write.status,
    });
  }
  if (exchange.refusal) blocks.push({ kind: 'refusal', ...exchange.refusal });
  return blocks;
}

/**
 * Each agent's sessions as the agent host keeps them: a chat per session, its requests and
 * replies, the newest chat first. The replies' speed is what a 4-bit Glimmer on a 12 GB card
 * writes, between 37 and 45 tokens a second of model time.
 */
export function agentHistory(
  agents: readonly AgentActivity[],
  now = new Date(),
): { chats: WorkspaceChat[]; messages: WorkspaceMessage[] } {
  const chats: WorkspaceChat[] = [];
  const messages: WorkspaceMessage[] = [];
  for (const agent of agents) {
    const span = spanOf(agent.since, now);
    agent.sessions.forEach((session, sessionIndex) => {
      const day = new Date(span.start + Math.round(session.at * span.days) * DAY);
      day.setHours(Math.floor(session.hour), Math.round((session.hour % 1) * 60), 0, 0);
      // Never before the acceptance; one that would start after the span's end starts before it.
      const planned = Math.max(day.getTime(), span.start + sessionIndex * 7 * MINUTE);
      const late = span.end - (agent.sessions.length - sessionIndex) * 23 * MINUTE;
      let at = planned > span.end ? Math.max(span.start, late) : planned;
      const createdAt = new Date(at).toISOString();
      const chatId = `cht_${session.id}`;
      session.exchanges.forEach((exchange, index) => {
        const prefix = `msg_${session.id}_${index + 1}`;
        const asked = new Date(at).toISOString();
        const worked = Math.round(exchange.seconds * 1000);
        at += worked;
        const tps = 37 + ((sessionIndex * 5 + index * 3) % 9);
        const modelMs = Math.round(worked * 0.62);
        messages.push({
          id: `${prefix}_q`,
          chatId,
          role: 'user',
          createdAt: asked,
          text: exchange.ask,
          steps: [],
          blocks: [],
          status: 'done',
        });
        messages.push({
          id: `${prefix}_a`,
          chatId,
          role: 'agent',
          createdAt: new Date(at).toISOString(),
          text: exchange.error === undefined ? exchange.answer : '',
          steps: stepsOf(exchange.steps, prefix),
          blocks: blocksOf(exchange, prefix),
          status: exchange.error === undefined ? 'done' : 'error',
          ...(exchange.error === undefined ? {} : { error: exchange.error }),
          workedMs: worked,
          generated: { tokens: Math.round((modelMs * tps) / 1000), ms: modelMs },
          graduateVersion: agent.version,
        });
        at += (2 + ((sessionIndex + index) % 5)) * MINUTE;
      });
      chats.push({
        id: chatId,
        graduateId: agent.graduateId,
        title: session.title,
        createdAt,
        updatedAt: new Date(at).toISOString(),
        running: false,
        waiting: false,
        graduateVersion: agent.version,
      });
    });
  }
  chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { chats, messages };
}
