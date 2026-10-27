import type { Task } from '@architect/shared';
import type {
  CompanyRecords,
  Customer,
  License,
  ServiceRequest,
  Skill,
  TimeWindow,
} from '../company/types';
import { addDays, daysBetween, longDate, minutesOf } from '../lib/calendar';
import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import { BUSINESS_DATE, CLOSED_DATES, NOON, SLOT_MINUTES, bookingIdFor } from '../policy/rules';
import { buildSchedule, earliestSlot, firstBookableDate } from '../reference/scheduling';
import type { EarliestSlot, Schedule, SchedulingRules } from '../reference/scheduling';
import type { JobVersion } from '../versions';
import { TODAY, withAnswerLine } from './prompts';
import { AnswerCap, difficultyOf, pickMix, pickMixWith, taskId } from './select';
import type { Candidate, Quota } from './select';

const FIRST_VERSION_QUOTA: Quota = { easy: 20, medium: 24, hard: 16 };

/**
 * Version 2 books a third of its requests within a customer time window. A morning window only
 * moves the answer when the morning is already full, which takes other traps too, so the morning
 * tasks it turns on are hard. Open requests of medium difficulty crowd onto a few early slots, so
 * the afternoon supplies more of the medium tasks.
 */
const QUOTAS: Readonly<Record<TimeWindow, Quota>> = {
  morning: { easy: 2, medium: 0, hard: 6 },
  afternoon: { easy: 0, medium: 11, hard: 1 },
  any: { easy: 7, medium: 13, hard: 20 },
};

/** No date and start time is the answer to more than three tasks. */
const MAX_TASKS_PER_SLOT = 3;

/** Half the customers who call ask for a morning or an afternoon visit. */
const WINDOW_CHOICES: readonly (readonly [TimeWindow, number])[] = [
  ['any', 2],
  ['morning', 1],
  ['afternoon', 1],
];

const ANSWER_SHAPE =
  '{"booking_id": "<id>", "technician_id": "<id>", "date": "<YYYY-MM-DD>", "start_time": "<HH:MM>"}';

const RULES: SchedulingRules = {
  businessDate: BUSINESS_DATE,
  closedDates: CLOSED_DATES,
  slotMinutes: SLOT_MINUTES,
  noon: minutesOf(NOON),
};

const FIRST_REQUEST_NUMBER = 3001;

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

interface Need {
  skill: Skill;
  license: License | null;
  durations: readonly number[];
  problems: readonly string[];
  weight: number;
}

const NEEDS: readonly Need[] = [
  {
    skill: 'plumbing',
    license: null,
    durations: [60, 90, 120],
    problems: [
      'Slow kitchen drain',
      'Running toilet',
      'Leak under the bathroom sink',
      'Low water pressure upstairs',
      'Dripping tub faucet',
    ],
    weight: 5,
  },
  {
    skill: 'plumbing',
    license: 'gas',
    durations: [120, 180],
    problems: ['Gas water heater keeps shutting off', 'Replace the gas water heater'],
    weight: 3,
  },
  {
    skill: 'plumbing',
    license: 'backflow',
    durations: [60],
    problems: ['Annual backflow test', 'Backflow test for the irrigation line'],
    weight: 2,
  },
  {
    skill: 'heating',
    license: null,
    durations: [60, 90],
    problems: ['Furnace tune-up before winter', 'New thermostat', 'Heat pump rattling'],
    weight: 3,
  },
  {
    skill: 'heating',
    license: 'gas',
    durations: [90, 120, 180],
    problems: ['Gas furnace will not ignite', 'Boiler service', 'No heat on the second floor'],
    weight: 3,
  },
  {
    skill: 'electrical',
    license: null,
    durations: [60, 90, 120],
    problems: [
      'Breaker keeps tripping',
      'Two new outdoor outlets',
      'Kitchen outlets dead',
      'Ceiling fan install',
    ],
    weight: 4,
  },
  {
    skill: 'electrical',
    license: 'master_electrician',
    durations: [180, 240],
    problems: ['Panel upgrade to 200 amps', 'EV charger circuit in the garage'],
    weight: 2,
  },
];

/** When customers can first be visited: mostly tomorrow or Monday, sometimes awkward days. */
const EARLIEST_DATES: readonly (readonly [string, number])[] = [
  ['2026-11-05', 1],
  ['2026-11-06', 4],
  ['2026-11-07', 1.5],
  ['2026-11-08', 1],
  ['2026-11-09', 3],
  ['2026-11-10', 2],
  ['2026-11-11', 1.5],
  ['2026-11-12', 1.5],
  ['2026-11-13', 1],
];

interface ScheduleCase {
  customer: Customer;
  request: Omit<ServiceRequest, 'request_id'>;
  slot: EarliestSlot;
}

export interface ScheduleTasks {
  /** The open requests, numbered from R-3001: exactly the ones the tasks book. */
  requests: ServiceRequest[];
  tasks: Task[];
}

export function buildScheduleTasks(
  random: Random,
  records: CompanyRecords,
  version: JobVersion,
): ScheduleTasks {
  const schedule = buildSchedule(records.technicians, records.bookings, records.travel);
  // Windows come from their own stream, so the rest of each request is drawn as in version 1.
  const windows = random.fork('windows');
  // One candidate request per customer, so no customer has two open requests.
  const candidates = random.shuffle(records.customers).map((customer) => {
    const need = random.weighted(NEEDS.map((n) => [n, n.weight] as const));
    const request: Omit<ServiceRequest, 'request_id'> = {
      customer_id: customer.customer_id,
      zone: customer.zone,
      skill: need.skill,
      license_needed: need.license,
      duration_minutes: random.pick(need.durations),
      earliest_date: random.weighted(EARLIEST_DATES),
      window: version === 1 ? 'any' : windows.weighted(WINDOW_CHOICES),
      problem: random.pick(need.problems),
    };
    return candidateFor(schedule, records, customer, request, version);
  });

  // Requests are numbered in order of their earliest date (the sort is stable).
  const numbered = pickRequests(random, candidates, version)
    .sort((a, b) => compareText(a.value.request.earliest_date, b.value.request.earliest_date))
    .map((candidate, index) => ({
      ...candidate,
      request: { request_id: `R-${FIRST_REQUEST_NUMBER + index}`, ...candidate.value.request },
    }));

  const tasks = numbered.map(({ value, traps, request }, index): Task => ({
    id: taskId('schedule', index),
    type: 'schedule',
    family: `request:${request.request_id}`,
    prompt: withAnswerLine(prompt(random, request, value.customer), ANSWER_SHAPE),
    expected: {
      kind: 'end_state',
      validator: 'booking_created',
      params: {
        request_id: request.request_id,
        booking_id: bookingIdFor(request.request_id),
        business_date: RULES.businessDate,
        closed_dates: [...RULES.closedDates],
        slot_minutes: RULES.slotMinutes,
        ...(version === 1 ? {} : { noon: NOON }),
      },
    },
    meta: {
      summary: `${value.slot.date} ${value.slot.start_time} with ${value.slot.technician_ids.join(' or ')}`,
      slot: { ...value.slot },
      difficulty: difficultyOf(traps),
      traps,
    },
  }));
  return { requests: numbered.map(({ request }) => request), tasks };
}

/**
 * Version 2 picks its morning, afternoon and open requests separately, then mixes them, so
 * requests on the same earliest date aren't numbered by window. A window that doesn't move the
 * answer only makes an easy task; every harder windowed task turns on its window. The open
 * requests always include the edges of a technician's day.
 */
function pickRequests(
  random: Random,
  candidates: readonly Candidate<ScheduleCase>[],
  version: JobVersion,
): Candidate<ScheduleCase>[] {
  if (version === 1) return pickMix(random, candidates, FIRST_VERSION_QUOTA, 'schedule');
  const cap = new AnswerCap(MAX_TASKS_PER_SLOT);
  const inWindow = (window: TimeWindow) =>
    candidates
      .filter(
        (c) =>
          c.value.request.window === window &&
          (window === 'any' || c.traps.includes('window') || c.traps.length === 0),
      )
      .map((c) => ({ ...c, answer: `${c.value.slot.date} ${c.value.slot.start_time}` }));
  const has = (trap: string) => (c: Candidate<ScheduleCase>) => c.traps.includes(trap);
  return random.shuffle([
    ...pickMix(random, inWindow('morning'), QUOTAS.morning, 'morning schedule', cap),
    ...pickMix(random, inWindow('afternoon'), QUOTAS.afternoon, 'afternoon schedule', cap),
    ...pickMixWith(
      random,
      inWindow('any'),
      QUOTAS.any,
      'schedule',
      [
        has('travel_to_next'),
        has('travel_to_next'),
        has('ends_at_day_end'),
        has('ends_at_day_end'),
      ],
      cap,
    ),
  ]);
}

function candidateFor(
  schedule: Schedule,
  records: CompanyRecords,
  customer: Customer,
  request: Omit<ServiceRequest, 'request_id'>,
  version: JobVersion,
): Candidate<ScheduleCase> {
  const asRequest = { request_id: 'R-0000', ...request };
  const slot = earliestSlot(schedule, RULES, asRequest);
  return {
    value: { customer, request, slot },
    traps: [
      ...scheduleTraps(schedule, records, asRequest, slot),
      ...(version === 1
        ? []
        : [...windowTraps(schedule, asRequest, slot), ...dayEdgeTraps(schedule, asRequest, slot)]),
    ],
    // Spreading picks across answers keeps "always book the same technician at 07:00" from
    // passing many tasks without a real slot search.
    kind: `${slot.date} ${slot.start_time} ${slot.technician_ids.join('+')}`,
  };
}

/**
 * The rules that decide this request. Each trap is a rule whose omission moves the answer, found
 * by re-running the reference search in a world with that one rule switched off.
 */
function scheduleTraps(
  schedule: Schedule,
  records: CompanyRecords,
  request: ServiceRequest,
  slot: EarliestSlot,
): string[] {
  const everyDayWorked: Schedule = {
    ...schedule,
    technicians: schedule.technicians.map((t) => ({ ...t, work_days: [...ALL_DAYS] })),
  };
  const withoutRule: [string, Schedule, SchedulingRules, ServiceRequest][] = [
    ['not_today', schedule, { ...RULES, businessDate: addDays(BUSINESS_DATE, -1) }, request],
    ['closed_day', schedule, { ...RULES, closedDates: [] }, request],
    ['license', schedule, RULES, { ...request, license_needed: null }],
    ['work_days', everyDayWorked, RULES, request],
    ['existing_bookings', buildSchedule(records.technicians, [], records.travel), RULES, request],
    ['travel_time', { ...schedule, travelMinutes: () => 0 }, RULES, request],
    ['half_hour_grid', schedule, { ...RULES, slotMinutes: 5 }, request],
  ];
  const traps = withoutRule
    .filter(([, world, rules, without]) => {
      const other = earliestSlot(world, rules, without);
      return other.date !== slot.date || other.start_time !== slot.start_time;
    })
    .map(([trap]) => trap);
  if (daysBetween(firstBookableDate(request, RULES), slot.date) >= 2) traps.push('days_later');
  return traps;
}

/**
 * Whether the customer's window moves the answer, and whether the answer sits right on the
 * window's edge: a morning visit ending at noon, or an afternoon visit starting at it.
 */
function windowTraps(schedule: Schedule, request: ServiceRequest, slot: EarliestSlot): string[] {
  if (request.window === 'any') return [];
  const anyTime = earliestSlot(schedule, RULES, request, 'window');
  const traps =
    anyTime.date !== slot.date || anyTime.start_time !== slot.start_time ? ['window'] : [];
  const onEdge = request.window === 'morning' ? slot.end_time === NOON : slot.start_time === NOON;
  return onEdge ? [...traps, 'window_edge'] : traps;
}

/**
 * The edges of a technician's day: an earlier gap that looks free but leaves no time to drive on
 * to the next booking, and an answer that ends exactly when the technician's day does.
 */
function dayEdgeTraps(schedule: Schedule, request: ServiceRequest, slot: EarliestSlot): string[] {
  const careless = earliestSlot(schedule, RULES, request, 'drive_to_next');
  const looksEarlier = careless.date !== slot.date || careless.start_time !== slot.start_time;
  const endsTheDay = schedule.technicians.some(
    (t) => slot.technician_ids.includes(t.technician_id) && t.end_time === slot.end_time,
  );
  return [...(looksEarlier ? ['travel_to_next'] : []), ...(endsTheDay ? ['ends_at_day_end'] : [])];
}

function prompt(random: Random, request: ServiceRequest, customer: Customer): string {
  const id = request.request_id;
  const templates = [
    `Today is ${TODAY}. Request ${id} from ${customer.name} (${request.problem}) is still open. ` +
      'Book it into the earliest slot a qualified technician has, and add the booking to bookings.csv.',
    `It's ${TODAY}. ${customer.name} called about request ${id} (${request.problem}). Schedule it ` +
      'at the earliest feasible time and record the booking in bookings.csv.',
    `Today is ${TODAY}. Please book open request ${id} as early as the schedule allows, and add ` +
      'it to bookings.csv.',
    `It's ${TODAY}. Find the first open slot for request ${id} (${customer.name}) and put the ` +
      `booking in bookings.csv. They can be visited from ${longDate(request.earliest_date)} on.`,
  ];
  return random.pick(templates);
}
