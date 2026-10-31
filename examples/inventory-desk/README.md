# Inventory desk: the compound store of a screening lab

The Inventory desk runs a screening lab's compound store. A scientist asks it how much of a compound is usable, which lot a re-test should come from, to allocate stock for a list of compounds sent for a re-test, and to reserve that stock. It works only from the lab's own files and follows the lab's own policy. `docs/FIELD.md` says why a job covers a whole field.

The labs are the Assay desk's (`examples/assay-desk`): the same four made-up labs, with the same roles and the same working days. Three are for teaching (Fenwick Screening Core, Alder Row Biosciences, Saltmarsh Institute Assay Lab) and one, Corvid Hill Discovery, is kept back: the Inventory desk is never taught on it, and it is there to show whether what it learned carries over to a lab it has never seen. Every lab, compound, lot and storage name is invented.

The two desks work as a team. The store holds every compound on the Assay desk's plates, and every list of compounds the Inventory desk allocates and reserves is one the Assay desk would queue for a re-test, taken from its own expected answers: all of a passing plate's inconclusive and borderline compounds when they fit its cap per plate, else exactly as many as the cap. The generator builds the Assay desk's labs from its seeds through its package, so the two jobs always agree.

## How the labs differ

- **Their date.** Each lab works on the Assay desk's day for it, and every request says what day it is ("It's Wednesday, October 14, 2026."). The job's header date, November 16, is none of them.
- **Units.** Each lab writes its volumes in a unit of its own (`45.5 µL`, `0.0455 mL` or `45500 nL`), and about one inventory row in seven, never in the first five, gives its quantity in another unit. Every value reads back to one volume.
- **Dates.** Each lab writes its dates one way (`2026-10-14`, `10/14/2026` or `14-Oct-2026`), in both files.
- **Names.** Lots, storage places and reservations are named the lab's way: `FL-04159` in rack `VR-06:E08`, `LOT934` in `F4/Box19/C1`, `SM-L1076` in source plate well `SRC-043 E11`, `CHL-20873` on `STORE2-SHELF7-70`.
- **The policy.** Written one of three ways: prose with the numbers in a table at the end, prose alone with some numbers in words, or a short list of rules. Every policy has the same kinds of rule, with its own numbers and words.

| Lab                           | Role     | Date   | Unit | Dates       | Policy  | Per re-test | Days left, at least | Draw first    | Combine lots | Reservations, at most | Reason codes                       |
| ----------------------------- | -------- | ------ | ---- | ----------- | ------- | ----------- | ------------------- | ------------- | ------------ | --------------------- | ---------------------------------- |
| Fenwick Screening Core        | train    | Oct 14 | µL   | 2026-10-14  | table   | 20 µL       | 30                  | expires first | no           | 3                     | EXPIRED, LOW-VOLUME, MAX-HOLDS     |
| Alder Row Biosciences         | train    | Oct 21 | mL   | 10/21/2026  | prose   | 0.015 mL    | 14                  | most free     | yes          | 2                     | exp, low, cap                      |
| Saltmarsh Institute Assay Lab | train    | Nov 5  | nL   | 05-Nov-2026 | bullets | 5000 nL     | 60                  | expires first | yes          | 4                     | OUT-OF-DATE, SHORT, LIMIT          |
| Corvid Hill Discovery         | transfer | Oct 28 | µL   | 2026-10-28  | bullets | 12 µL       | 21                  | most free     | no           | 5                     | EXPIRING, INSUFFICIENT, HOLD-LIMIT |

Corvid Hill's numbers are ones no taught lab uses, and no taught lab draws the largest lot first without combining lots.

## The rules every lab shares

The policies all say the same things in their own words:

- A lot's free volume is its quantity less every amount reservations.csv holds on it.
- A lot is in date for a re-test when it expires at least the lab's number of days after the day of the request.
- At a lab that doesn't combine lots, a lot is usable when it is in date and has at least one re-test's stock free, and a re-test draws its stock from the first usable lot. At a lab that combines, every lot in date with free volume is usable, and a re-test takes everything free from each lot in order until it has its stock, and from the last only what it still needs.
- The order is the lab's: the lot that expires first, or the one with the most free volume.
- How much of a compound is usable is the free volume of its usable lots together.
- First, whether a re-test can be drawn at all: a compound with no lot in date gets the no-lot-in-date code, and one whose lots in date can't make up a re-test gets the too-little code.
- A re-test that can be drawn is allocated and reserved only if the compound's rows in reservations.csv, with one new row for each lot drawn, come to no more than the lab's limit; otherwise it gets the limit code. So at a lab that combines lots, a compound one row under the limit can't take a re-test drawn from two lots.
- A reservation adds one row per lot drawn from: the id numbered on from the file, the compound, the lot, the amount as a number and the lab's unit, and the day of the request in the lab's date form. A compound with nothing to draw gets no row.

## Files

Every lab's files sit in `job/orgs/<id>/data/`.

| File             | Columns                                                          | Rows           |
| ---------------- | ---------------------------------------------------------------- | -------------- |
| policy.md        | the lab's rules, in its own style                                |                |
| inventory.csv    | compound_id, lot, location, quantity, conc_mm, received, expires | 970 to 1,943   |
| reservations.csv | reservation_id, compound_id, lot, amount, reserved_on            | 42 to 268      |

The agent may write only to `reservations.csv`, and the job asks before every write.

**The store.** Every compound on the Assay desk's plates has one to three lots. Most are in date with plenty left; some have expired or expire inside the lab's cutoff, and some hold less than a re-test takes. About one compound in twelve has stock held already. Among the compounds the Assay desk sends for a re-test, two are made to have nothing to draw for each reason, and at a lab that combines lots one has two lots that only together make up a re-test. No two lots in date of one compound share an expiry or a free volume, and no expiry sits within two days of the lab's cutoff, so which lot comes first is never in doubt.

## Tasks

128 tasks: 32 at each lab, 8 of each skill. Ids carry the lab (`fenwick-pick_lot-03`), and families never cross a lab. The 96 tasks of the three taught labs split into 8 calibration, 40 practice, 24 check and 24 final-test tasks; Corvid Hill's 32 are for the final test only. Requests read like a scientist at the bench, start with the lab's date and end with the ANSWER line they want.

| Skill      | The request                                                                                         | What is checked                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `usable`   | "How much FWC-10882 do we have that we can actually use?"                                            | the usable volume in µL within 0.05, and the usable lots as a set (`usable_volume`)                   |
| `pick_lot` | "Which lot of FWC-12919 should I pull for a re-test, and where is it?"                               | each lot drawn, its location and amount, or the lab's reason code when there is nothing (`lot_pick`)  |
| `allocate` | "Assay desk sent these from FW-0416 for a re-test: FWC-12928, FWC-12949, FWC-12976 and FWC-12988. Which lot does each come from?"                 | the same for every compound of the list, none missing and none added (`allocation`)                   |
| `reserve`  | "Please put holds on stock for the FW-0418 re-tests: FWC-13399 and FWC-13444."                       | the rows added to reservations.csv, and which compounds were reserved and why not the others (`reservation`) |

Every lab asks for a lot of a compound with nothing in date, one too short, one at its reservation limit, one whose first-expiring lot is not its largest, and at a lab that combines lots one drawn from two lots. The `allocate` and `reserve` tasks of a lab go through the same eight lists, each pair in one family; most lists have a compound with nothing to draw.

## The team demo with the Assay desk

The first `allocate` and `reserve` tasks at every lab take the same list: the longest one the Assay desk queues whole, so the compounds it returns are exactly the ones it queues, whichever valid plan it picks. One compound on it always has nothing to draw. At Fenwick, on Wednesday, October 14, 2026:

1. **Assay desk** (`fenwick-plate_report-01` in `examples/assay-desk`): plate FW-0418 passes QC with Z′ 0.7689. Its compounds to re-test are FWC-13399 (INCONCLUSIVE) and FWC-13444 (BORDERLINE); the cap is 4, so it queues both, as RT-0006 and RT-0007.
2. **Inventory desk** (`fenwick-allocate-01`, `fenwick-reserve-01`), allocating exactly those two:
   - FWC-13399: nothing to draw, reason LOW-VOLUME. Its three lots are all in date, but none has 20 µL free (FL-04134 5.5 µL, FL-04135 1.5 µL, FL-04136 16 µL), and Fenwick doesn't combine lots.
   - FWC-13444: 20 µL from lot FL-04159 in rack VR-06:E08. It expires on 2026-12-07, 54 days out, the first of its usable lots to expire; FL-04158 (228.5 µL, 2028-07-05) comes later, and FL-04160 (14.5 µL) is too small.
   - The reservation adds one row, `HOLD-0163,FWC-13444,FL-04159,20 µL,2026-10-14`, and the answer is `{"reserved": ["FWC-13444"], "unavailable": [{"compound": "FWC-13399", "reason": "LOW-VOLUME"}]}`.

The other labs' lists: Alder Row AR-2214 (ARX000492 draws 0.015 mL from LOT934; ARX000508 has too little, `low`), Saltmarsh SALT-029 (SM-5030-01 has no lot in date, `OUT-OF-DATE`; the other three draw 5000 nL each), Corvid Hill CH-0932 (CHD-67485 has too little, `INSUFFICIENT`; the other two draw 12 µL each).

## Checker

`src/checker.js`, copied into the job folder, holds the four validators. It reads no clock and no randomness. Volumes pass within 0.05 µL, lists of lots and compounds compare as sets, and ids and locations pass whatever their case, spaces and punctuation. A compound with nothing to draw needs its reason and an empty `draws` list. A new row is graded against the format the lab's policy states: its amount a number and the lab's unit (`20 µL`, or `20 uL`, at Fenwick; `0.02 mL`, a bare `20` or a date written `10/14/2026` fail there), its date in the lab's form. A reservation passes when it adds exactly the rows the lab's rules draw, in any order, numbered on from the file, with no old row changed. A failure's reason starts with the field or table that is wrong. The expected values come from the true lots and holds, before any file wrote them (`src/lab/stock.ts`).

## Reference solutions

`src/reference/solver.ts` solves every task with the agent's built-in tools only. It reads policy.md (`src/reference/policy.ts` reads the rules back from any of the three styles), sends one piece of code to `run` (`src/reference/code.ts`) that reads each volume with its unit and each date in any form, works out each lot's free volume from the reservations and draws by the rules, and then appends any reservations. It knows nothing about one lab. Every task takes at most three tool calls and well under 24,000 characters of tool results.

## Tests

- The committed folder matches the generator byte for byte, and the same seeds always give the same bytes.
- The labs are the Assay desk's, with the same names, roles and days, and the store holds every compound in each lab's `compounds.csv`.
- The four labs differ in every number and code, the taught labs use all three units, date forms and policy styles, both orders and both ways of combining, and the lab never seen has numbers and a pairing of rules no taught lab uses.
- The rules in policy.md, in every style, read back to the ones the lab was built with.
- Every inventory row reads back to its lot's true volume and dates, and the share written in another unit stays in its range, none in the first rows. No reservation holds more than its lot has.
- Free volume, the cutoff, the order of lots, combining, every reason and the limit counted with the new rows match a store worked by hand, both in the generator's rules and in the reference's code, in every unit and date form.
- The checker passes the ground truth with ids and lists written other ways, and fails the common mistakes for the right reason: a volume off, a missing or extra lot, a wrong lot, amount or location, a missing or wrong reason, draws missing or not empty for a compound with nothing to draw, a missing, extra or repeated compound, a row for a compound with nothing to draw, a wrong amount, date or id, an amount or date not written the lab's way, a missing or repeated row, a changed old row, and a write from a task that only asks.
- The tasks split into the sizes the job asks for, with every family in one split, and every list is exactly one the Assay desk queues, within its cap per plate.
- The demo's list at every lab is one the Assay desk queues whole, it has a compound with nothing to draw and one that can be drawn, and this README gives Fenwick's true values.
- The reference solutions' calls are replayed through the engine's own tools on each lab's files, the text they get back is compared, and every task passes the engine's checker.

## Known gaps

- The job has not been calibrated on the bare student yet.
- The store keeps one stock solution per lot; a lab that tracks dilutions, freeze-thaw counts or plate maps of source plates would need rules of its own.
- The app doesn't offer it as a sample yet; import `job/job.json` to try it.

## Regenerate

```
pnpm --filter @architect/example-inventory-desk generate
```
