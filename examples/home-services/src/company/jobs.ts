import { datesFrom, weekdayOf } from '../lib/calendar';
import type { Random } from '../lib/random';
import { BUSINESS_DATE } from '../policy/rules';
import { TECHNICIANS, WORK_TYPES } from './catalog';
import type { WorkType } from './catalog';
import type { CustomerBase } from './customers';
import type { Job, JobPart, Technician } from './types';

/** The records start when the office moved to its current system. */
const HISTORY_START = '2026-05-04';

/** Heating calls double from October on. */
const HEATING_SEASON_START = '2026-10-01';

export interface JobHistory {
  jobs: Job[];
  jobParts: JobPart[];
}

/** Every job finished since HISTORY_START, about 1,500, numbered in date order from W-1001. */
export function buildJobs(random: Random, base: CustomerBase): JobHistory {
  const callers = base.customers.flatMap((customer) =>
    base.businesses.has(customer.customer_id) ? [customer, customer, customer] : [customer],
  );
  const jobs: Job[] = [];
  const jobParts: JobPart[] = [];

  for (const date of datesFrom(HISTORY_START, BUSINESS_DATE)) {
    const weekday = weekdayOf(date);
    if (weekday === 'Sun') continue;
    const count =
      weekday === 'Sat'
        ? random.int(2, 5)
        : date === BUSINESS_DATE
          ? random.int(5, 8)
          : random.int(8, 13);

    for (let i = 0; i < count; i++) {
      const { work, technician } = pickWork(random, date);
      const job_id = `W-${1001 + jobs.length}`;
      jobs.push({
        job_id,
        customer_id: random.pick(callers).customer_id,
        technician_id: technician.technician_id,
        date,
        work: work.name,
        labor_minutes: random.int(work.minutes[0], work.minutes[1]),
        after_hours: random.chance(work.afterHoursChance),
      });
      for (const use of work.parts) {
        if (random.chance(use.chance)) {
          jobParts.push({ job_id, part_id: use.partId, qty: random.int(use.qty[0], use.qty[1]) });
        }
      }
    }
  }
  return { jobs, jobParts };
}

/** A kind of work, and a technician qualified for it who works that day. */
function pickWork(random: Random, date: string): { work: WorkType; technician: Technician } {
  const weekday = weekdayOf(date);
  const heatingBoost = date >= HEATING_SEASON_START ? 2 : 1;
  const choices = WORK_TYPES.map(
    (work) => [work, work.weight * (work.skill === 'heating' ? heatingBoost : 1)] as const,
  );
  for (;;) {
    const work = random.weighted(choices);
    const crew = TECHNICIANS.filter(
      (t) =>
        t.skills.includes(work.skill) &&
        (work.license === null || t.licenses.includes(work.license)) &&
        t.work_days.includes(weekday),
    );
    if (crew.length > 0) return { work, technician: random.pick(crew) };
  }
}
