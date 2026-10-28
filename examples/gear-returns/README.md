# Returns desk: the second sample job

Larchwood Outfitters is a made-up outdoor-gear shop that sells online to four regions. Its agent, Returns desk, works as of Tuesday, November 24, 2026: it decides return requests and records them in returns.csv, answers questions about orders, and books carrier pickups for approved returns into pickups.csv. Decision 028 says why the job exists.

The policy states every rule with a worked example, as the first job's does, and hides nothing. What differs is the data. The files read as exports from different systems: in about a fifth of the rows of each table some value is written another way. Dates appear as `2026-11-23`, `11/23/2026` or `Nov 23, 2026`; money as `1234.50`, `1234.5`, `$1,234.50` or `1,234.50 USD`; a SKU or an email can carry a stray space or odd capitals; and a few products still carry a category code from the shop's first till, which `category_map.csv` explains. The first five rows of every file are plain, which covers the three sample rows a mentor is shown, and the other forms are spread through the rest. The policy says the files came from different systems and nothing about how any of them wrote a value.

## Files

| File | Rows | Written another way |
| --- | --- | --- |
| customers.csv | 160 | 17.5% (emails, `member_since`) |
| products.csv | 64 | 20.3% (SKUs, old category codes, list prices) |
| orders.csv | 595 | 17.5% (order, ship and delivery dates, shipping) |
| order_lines.csv | 1,037 | 21.5% (SKUs, unit prices) |
| returns.csv | 247 | 20.2% (SKUs, `decided_on`, `pickup_from`) |
| pickups.csv | 81 | 17.3% (pickup and booking dates) |
| category_map.csv | 10 | none: it is the key to the old codes |

Every other form reads back to one value without anything outside the files: a date is only written month first when its day can't be a month, and no SKU or email is part of another.

## Tasks

180 tasks, 60 of each type, split like the first job's (calibration 15, train 60, dev 45, test 60) with the job's own seed. Refunds and pickups are grouped by order and questions by customer, product or region, so near-duplicates stay in one split.

- **Refunds** (`return_recorded`). A request names an order, a SKU, a quantity and a condition. The agent decides it (return window from delivery, longer with member perks on the order, final sale, units left), works out the item amount, restocking fee, return label, shipping refund and where the money goes, adds one row to returns.csv, and ends with the decision and refund in cents. 17 of the 60 are denied.
- **Order questions** (`order_answer`), 15 of each: what a customer spent in a category since a date, a product's units and sales in a month, a region's unshipped orders placed by a date, and a customer's orders in a month with their total.
- **Pickups** (`pickup_booked`). The agent books an approved return's carrier (by region, or the freight carrier for a bulky product) on the earliest date that fits its pickup days, the 14:00 cutoff, Thanksgiving, the customer's `pickup_from` date and how full the day already is.

88 of the 180 tasks turn on a value written another way: 32 refunds, 40 questions and 16 pickups. Each task's `meta.traps` lists the rules and forms it turns on.

## Checker

`src/checker.js`, copied into the job folder, holds the three validators and reads no clock and no randomness. Money in an ANSWER line passes within half a cent of the expected cents, so floating-point noise passes and a cent off fails; money written into a table must be whole cents. Lists of order ids compare as sets. A failure's reason starts with the field that is wrong, so a locked-test result keeps that field and nothing else. The expected values come from the reference rules in `src/reference/`, applied to the true records before any export wrote them.

## Tests

The tests check that the committed folder matches the generator byte for byte, and that each table's share of other forms is 15 to 25 percent, plain in its first five rows and spread through the rest. Every other form reads back to its true value, and the past returns and pickups follow the policy. The worked examples in the policy match the reference rules. A second implementation of the policy, working on the CSV text, agrees with every task. The checker passes every ground truth and fails the common mistakes for the right reason, in node and in the engine's own sandbox. No answer is right for more than three tasks of a type. With the runner's split, the rows train attempts read include other forms in every exported table.

The reference solutions in `src/reference/solver.ts` use only the agent's built-in tools. Each reads the policy, sends code to `run` that fetches the rows the task needs and works out any sums, and for a refund or a pickup appends the new row. `src/reference/tools.ts` models those tools rule for rule (a read numbers its lines and stops at 200 lines or 8,000 characters; a run's result has to fit 8,000 characters whole), and the tests replay every call of every task through the engine's own tools, compare the text the agent gets back, and grade the end state and the answer with the engine's checker. Every task is solved within 16 turns: at most 5 tool calls for a refund, 5 for a question and 4 for a pickup, and at most 12,341 characters of tool results, the policy included.

The job has not been calibrated on the bare student yet; that needs hosted credit.

## Regenerate

```
pnpm --filter @architect/example-gear-returns generate
```
