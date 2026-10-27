import type { Weekday } from '../lib/calendar';

/**
 * One interface per CSV file. Field names match the column names, so the reference calculations
 * read like the policy (`job.labor_minutes`, `part.markup_pct`). `yes`/`no` columns are booleans
 * here and `;` lists are arrays; `tables.ts` converts both ways.
 */

export type Zone = 'Harbor' | 'Old Town' | 'Millbrook' | 'Ridge' | 'Lakeside';
export type Skill = 'plumbing' | 'heating' | 'electrical';
export type License = 'gas' | 'backflow' | 'master_electrician';
export type Tier = 'apprentice' | 'journeyman' | 'lead';

export interface Customer {
  customer_id: string;
  name: string;
  city: string;
  zone: Zone;
  plan_member: boolean;
  terms_days: number;
}

export interface Technician {
  technician_id: string;
  name: string;
  tier: Tier;
  skills: Skill[];
  licenses: License[];
  work_days: Weekday[];
  start_time: string;
  end_time: string;
}

export interface Rate {
  tier: Tier;
  hourly_rate_cents: number;
}

export interface Part {
  part_id: string;
  name: string;
  unit_cost_cents: number;
  markup_pct: number;
  taxable: boolean;
}

export interface Job {
  job_id: string;
  customer_id: string;
  technician_id: string;
  date: string;
  work: string;
  labor_minutes: number;
  after_hours: boolean;
}

export interface JobPart {
  job_id: string;
  part_id: string;
  qty: number;
}

export interface Invoice {
  invoice_id: string;
  job_id: string;
  customer_id: string;
  issue_date: string;
  due_date: string;
  labor_cents: number;
  parts_cents: number;
  fees_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
}

export interface Payment {
  payment_id: string;
  invoice_id: string;
  date: string;
  amount_cents: number;
}

/** When the customer can be visited: the whole visit before noon, from noon on, or any time. */
export type TimeWindow = 'morning' | 'afternoon' | 'any';

export interface ServiceRequest {
  request_id: string;
  customer_id: string;
  zone: Zone;
  skill: Skill;
  license_needed: License | null;
  duration_minutes: number;
  earliest_date: string;
  /** Always `any` in version 1, whose requests.csv has no window column. */
  window: TimeWindow;
  problem: string;
}

export interface Booking {
  booking_id: string;
  request_id: string;
  technician_id: string;
  date: string;
  start_time: string;
  end_time: string;
  zone: Zone;
}

export interface TravelTime {
  from_zone: Zone;
  to_zone: Zone;
  minutes: number;
}

export interface TaxRate {
  city: string;
  rate_bp: number;
}

export interface Company {
  customers: readonly Customer[];
  technicians: readonly Technician[];
  rates: readonly Rate[];
  parts: readonly Part[];
  jobs: readonly Job[];
  jobParts: readonly JobPart[];
  invoices: readonly Invoice[];
  payments: readonly Payment[];
  requests: readonly ServiceRequest[];
  bookings: readonly Booking[];
  travel: readonly TravelTime[];
  taxRates: readonly TaxRate[];
}

/** Everything but the open requests, which are chosen together with the scheduling tasks. */
export type CompanyRecords = Omit<Company, 'requests'>;
