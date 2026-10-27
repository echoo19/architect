# Ferncliff Home Services: office policy

These are the rules for the office's end-of-day work: invoices, overdue balances and scheduling.

The records are current as of the business date, **Thursday, November 5, 2026** (2026-11-05). "Today" always means the business date. Dates are written YYYY-MM-DD and times as 24-hour HH:MM. Money is always a whole number of cents: 32008 means $320.08.

**Rounding.** "Round half up" means round to the nearest whole cent, with exact halves going up: 1717.5 becomes 1718 and 1717.49 becomes 1717.

## Invoices

When a job is finished, add one row for it to invoices.csv. Work out the amounts in this order.

1. **Labor** (`labor_cents`). Round the job's `labor_minutes` up to the next quarter hour, and bill at least 60 minutes: 47 minutes bills 60, 61 bills 75, 95 bills 105. Multiply the billed hours by the hourly rate for the technician's tier (the tier is in technicians.csv, the rate in rates.csv). An after-hours job (`after_hours` = yes) costs 1.5 times that. Round half up.
2. **Parts** (`parts_cents`). Each row of job_parts.csv for the job is one line: qty × `unit_cost_cents` × (100 + `markup_pct`) ÷ 100, rounded half up line by line. Add up the rounded lines. A job with no parts has 0.
3. **Trip fee** (`fees_cents`). One per job, by the customer's zone: 3900 for Harbor and Old Town, 5500 for Millbrook and Ridge, 6900 for Lakeside.
4. **Plan discount** (`discount_cents`). Customers with `plan_member` = yes get 10% off `labor_cents`, rounded half up. The discount never applies to parts, fees or tax. Everyone else gets 0.
5. **Tax** (`tax_cents`). Only parts lines whose part is `taxable` = yes are taxed. Add those lines up, multiply by the rate for the customer's city in tax.csv (`rate_bp` is in basis points: 825 means 8.25%), and round half up once, on that subtotal. Labor, the trip fee and the discount are never taxed.
6. **Total** (`total_cents`) = labor + parts + fees − discount + tax.
7. **Numbering and dates.** `invoice_id` is INV- plus the job's number: job W-1234 gets INV-1234. `issue_date` is the business date, even when the job finished earlier. `due_date` is the issue date plus the customer's `terms_days` (0 means due the same day). Fill in the job's `job_id` and `customer_id` too.

Example: a journeyman (11400 an hour) spends 50 minutes on an after-hours job for a plan member in Marlow (850 basis points), whose zone is Millbrook. The job used 2 of a taxable part that costs 1235 with a 35% markup, and one plumbing permit (7500, no markup, not taxable).

- Labor: 50 minutes bills 60, so 1 hour × 11400 × 1.5 = 17100.
- Parts: 2 × 1235 × 1.35 = 3334.5, which rounds to 3335. The permit is 7500. Parts total 10835.
- Trip fee: Millbrook, 5500.
- Discount: 10% of 17100 = 1710.
- Tax: only the 3335 line is taxable. 3335 × 8.5% = 283.475, which rounds to 283.
- Total: 17100 + 10835 + 5500 − 1710 + 283 = 32008.

## Overdue balances

- An invoice's **balance** is its `total_cents` minus its payments in payments.csv dated on or before the business date. A payment dated after the business date is scheduled, not received yet: leave it out.
- An invoice is **overdue** when its `due_date` is before the business date and its balance is above zero. An invoice due on the business date is not overdue yet.
- **Days overdue** counts calendar days from the due date to the business date: an invoice due 2026-10-31 is 5 days overdue today.
- A customer's **overdue balance** is the sum of the balances of their overdue invoices.

Example: an invoice for 30000 due 2026-10-20 has payments of 10000 on 2026-10-25 and 20000 on 2026-11-10. Today it is 16 days overdue, with a balance of 20000.

**Groups of customers.** A question can be about a group named from customers.csv: the customers in a `zone` or a `city`, plan members (`plan_member` = yes), or customers on given terms (15-day terms means `terms_days` = 15).

- A group's **overdue total** is the sum of its customers' overdue balances.
- A customer is **more than N days overdue** when at least one of their overdue invoices is more than N days overdue. Exactly N days is not more than N.
- A customer **owes more than** an amount when their overdue balance is above it. $500 is 50000 cents.
- When you list customers with their balances, put the largest balance first.

Example: in a group of three, A owes 12000 on one invoice that is 31 days overdue. B's only overdue invoice is for 20000 and exactly 30 days overdue, and B paid 5000 of it today, so B owes 15000. C has nothing overdue. The group's overdue total is 27000. Only A is more than 30 days overdue. Largest first, B owes 15000 and A 12000. Nobody owes more than $150 (15000).

## Scheduling

Book each new service request into the earliest slot that works, and add one row for it to bookings.csv.

- **Dates.** Book from the day after the business date on, and never before the request's `earliest_date`. The office is closed on Wednesday, November 11, 2026 for the staff training day: no bookings that day.
- **Who.** The technician needs the request's `skill` in their `skills` and, when `license_needed` is set, that license in their `licenses`. They must work that weekday (`work_days`).
- **Hours.** The whole booking fits in the technician's day: it starts at or after `start_time` and ends by `end_time`. Bookings start on the hour or half hour and last exactly `duration_minutes`.
- **Time window.** The request's `window` says when the customer can be visited: `morning` means the booking ends by 12:00, `afternoon` means it starts at 12:00 or later, and `any` adds no limit. The technician's hours still apply.
- **Travel.** Between two bookings on the same day, a technician needs the travel time in travel.csv from the earlier booking's zone to the later one's (it also lists the time between two jobs in the same zone). So the new booking can start no earlier than the end of the booking before it plus the drive to the new zone, and must end early enough to drive on to the booking after it. Travel before the first booking of the day or after the last one doesn't count.
- **Earliest.** Pick the earliest date and start time that any qualified technician can do. If several technicians can start at that same time, any of them is fine.
- **The row.** `booking_id` is B- plus the request's number (request R-1234 gets B-1234). Fill in `request_id`, `technician_id`, `date`, `start_time`, `end_time` (start plus the duration) and `zone` (the request's zone).

Example: a technician's booking in Harbor ends at 10:00. The new job is in Ridge, 45 minutes from Harbor, so it can start at 10:45 at the earliest, which on the half-hour grid is 11:00. If it lasts 120 minutes it ends at 13:00, and with the 30-minute drive from Ridge to Old Town the technician can still make a booking in Old Town that starts at 13:30 or later.

Example: a 120-minute `morning` request can start at 10:00 at the latest, ending exactly at 12:00. A 90-minute `afternoon` request can start at 12:00 at the earliest; with a technician who works until 16:00 it can start as late as 14:30, ending exactly at the end of their day.
