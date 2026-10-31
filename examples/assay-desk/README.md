# Assay desk: a field of screening labs

The Assay desk helps a screening lab read its plate-reader exports. A scientist asks it about a plate: what a well's percent inhibition is, whether the plate passed QC, which compounds are hits, whether two replicate wells agree, and what to put in the re-test queue. It works only from the lab's own files and follows the lab's own policy. `docs/FIELD.md` says why a job covers a whole field.

The job holds four made-up labs, built from seeds. Three are for teaching (Fenwick Screening Core, Alder Row Biosciences, Saltmarsh Institute Assay Lab) and one, Corvid Hill Discovery, is kept back: the Assay desk is never taught on it, and it is there to show whether what it learned carries over to a lab it has never seen. Every lab, compound and instrument name is invented.

## How the labs differ

- **Their date.** Each lab works on a day of its own, and every request says what day it is ("It's Wednesday, October 14, 2026."). The job's header date, November 16, is none of them.
- **Instruments.** Three made-up plate readers write three kinds of export. The Lumen 3 (`lumen_export.csv`: `Plate ID, Well, Counts`) names wells `A01`, writes whole counts, some with a thousands separator (`"41,234"`), and marks a saturated well `OVRFLW` and a missed one with an empty cell. The Kestrel HT (`kestrel_export.csv`: `Barcode, Row, Col, RFU`) gives the row and the column in two cells, writes the plate id without its hyphen and sometimes in lower case (`fw0411`), reads a plate column by column, writes one decimal, and marks no reading `OVER` or `-`. The Orbit 2 (`orbit_export.csv`: `Plate, Well Position, Raw Signal`) names wells `A1`, writes some values in scientific notation (`4.5123E+04`), and marks no reading `Overflow` or `NaN`. Each lab has two or three of them, so a lab has only some of the export files.
- **Layouts.** Each lab reads eight plates, some of 96 wells and some of 384.
- **Controls.** Where the control wells sit differs: negatives in the first column and positives in the last, the other way round, the first two columns, or alternating rows down both edges. The well map, `compounds.csv`, marks them with the lab's own codes (`DMSO` and `STAU`, `NEG` and `POS`, `HI` and `LO`, `VEH` and `REF`).
- **How values are written.** In `compounds.csv` about one row in five names its well the other way (`A1` or `A01`), and about as many write the compound id in lower case or with a leading space. `plates.csv` writes its dates one way (`2026-10-14`, `10/14/2026` or `14-Oct-2026`) and two plates another, and its layout as `96`, `96-well` or `96w`. In the Lumen and Orbit exports, 10 to 30 percent of readings are written another way. The first five rows of every big table are plain, which covers the sample rows a mentor is shown. Every value reads back to exactly one value.
- **The policy.** Written one of three ways: prose with the numbers in a table at the end, prose alone with some numbers in words, or a short list of rules. Every policy has the same kinds of rule, with its own numbers and words.

| Lab                           | Role     | Date   | Instruments            | Policy  | Hit rule        | Lowest Z′ | Borderline | Agree within | Replicates | Re-tests per plate | Duplicated |
| ----------------------------- | -------- | ------ | ---------------------- | ------- | --------------- | --------- | ---------- | ------------ | ---------- | ------------------ | ---------- |
| Fenwick Screening Core        | train    | Oct 14 | Lumen, Kestrel         | table   | ≥ 50%           | 0.5       | ± 10       | 20           | mean       | 4                  | a quarter  |
| Alder Row Biosciences         | train    | Oct 21 | Kestrel, Orbit         | prose   | ≥ 3 SD          | 0.4       | ± 5        | 15           | every well | 3                  | all        |
| Saltmarsh Institute Assay Lab | train    | Nov 5  | Lumen, Orbit           | bullets | ≥ 40%           | 0.6       | ± 8        | 25           | mean       | 6                  | half       |
| Corvid Hill Discovery         | transfer | Oct 28 | Orbit, Lumen, Kestrel  | bullets | ≥ 2.5 SD        | 0.45      | ± 7        | 18           | every well | 5                  | a quarter  |

Corvid Hill's numbers are ones no taught lab uses, and it is the only lab with all three instruments.

## The rules every lab shares

The policies all say the same things in their own words:

- A well with no number in the export (blank, a dash, `NaN`, an overflow mark) has no reading and is left out of everything.
- Percent inhibition = 100 × (negative mean − signal) / (negative mean − positive mean), against the plate's own controls.
- Z′ = 1 − 3 × (positive SD + negative SD) / |positive mean − negative mean|, with the sample standard deviation. A plate passes at the lab's lowest Z′ or above. A plate that fails gets no hit calls and is re-tested whole.
- A hit reaches the lab's threshold: a percent inhibition, or a number of standard deviations of the negative controls' own percent inhibition.
- A compound is inconclusive when any of its wells has no reading or its wells differ by more than the lab's agreement limit. Otherwise a compound run in two wells is called on their mean, or, at labs that say so, is a hit only when both wells reach the threshold.
- A compound that is not inconclusive is borderline when its mean is within the lab's band of the threshold, on either side.
- Re-tests go in `retests.csv`: one row for a failed plate (compound left empty), and on a passing plate its inconclusive and borderline compounds, up to the lab's cap per plate, with the lab's reason codes. When more qualify than the cap, any of them will do. Nothing already in the queue is asked for again.

## Files

Every lab's files sit in `job/orgs/<id>/data/`.

| File               | Columns                                                   | Rows           |
| ------------------ | --------------------------------------------------------- | -------------- |
| policy.md          | the lab's rules, in its own style                         |                |
| plates.csv         | plate_id, layout, instrument, read_on, export_file        | 8              |
| compounds.csv      | plate_id, well, compound_id, conc_um                      | 1,344 to 1,920 |
| lumen_export.csv   | Plate ID, Well, Counts                                    | 288 to 672     |
| kestrel_export.csv | Barcode, Row, Col, RFU                                    | 480 to 960     |
| orbit_export.csv   | Plate, Well Position, Raw Signal                          | 672 to 1,248   |
| retests.csv        | retest_id, plate_id, compound_id, reason, requested_on    | 5              |

The three export files are marked optional in `job.json`, since a lab has only the ones for its instruments. The agent may write only to `retests.csv`.

**The plates.** Signals follow a simple model of an inhibition assay: negative controls read high, positive controls low, most compounds near the negatives, and a few actives part or all the way down. Each lab has plates that pass comfortably, at least two that fail, one that passes just above the line and one that fails just below it. A replicate now and then goes astray, as a pipetting slip would, and every plate has at least one well without a reading. No compound's value sits within 0.05 points of a threshold, a band edge or the agreement limit, and no Z′ within 0.005 of the lab's line, so rounding never changes a call.

**The queue.** `retests.csv` already holds requests for two older plates, one for the lab's first failed plate and one for a compound of its first passing plate that needs re-testing. A task on either plate finds part of its work done.

## Tasks

192 tasks: 48 at each lab, 8 of each skill. Ids carry the lab (`fenwick-qc-03`), and families never cross a lab. The 144 tasks of the three taught labs split into 12 calibration, 60 practice, 36 check and 36 final-test tasks; Corvid Hill's 48 are for the final test only. Requests read like a scientist at the bench, start with the lab's date and end with the ANSWER line they want.

| Skill          | The request                                                          | What is checked                                                                                       |
| -------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `normalize`    | "Can you give me the percent inhibition for wells C05, H11 and K17?" | each well's percent inhibition within 0.5 points, or null for a well with no reading (`inhibition`)  |
| `hits`         | "Pull the hit list for FW-0412, please."                             | the hit set, compared as a set; empty on a plate that fails QC (`hit_set`)                            |
| `qc`           | "Did plate FW-0415 pass QC? What's its Z′?"                          | Z′ within 0.01, and pass or fail (`plate_qc`)                                                         |
| `replicates`   | "Do the wells of ARX000486 agree, and what's the call?"              | each well's percent inhibition, their mean, whether they agree, and the call (`replicate_call`)       |
| `retest_plan`  | "Queue the re-tests for the plates we read on October 8."            | the rows added to retests.csv, any valid plan, and the count in the ANSWER (`retest_plan`)            |
| `plate_report` | "Write up plate SALT-029: QC, the hits, and queue the re-tests."     | Z′, QC, the hit set, the re-test rows and their count (`plate_report`)                                |

Wells in a request are named either way (`C5` or `C05`), and the answer may name them either way too. Every lab has a request that names a well with no reading, a hit list for a failed plate, replicates called hit, inactive and inconclusive, a failed plate to queue whole, a failed plate already queued, and a plate with more compounds to re-test than its cap.

## Checker

`src/checker.js`, copied into the job folder, holds the six validators. It reads no clock and no randomness. Numbers pass within the task's tolerance, lists of compounds compare as sets, ids pass whatever their case, spaces and punctuation, and wells pass however they are named. A re-test plan passes when it keeps to the rules, whichever compounds it picks when more qualify than the cap and in whatever order: the right rows for each plate, the lab's reason codes, the request's date, ids numbered on from the file, and no old row changed. A failure's reason starts with the field or table that is wrong. The expected values come from the true wells, before any export wrote them (`src/lab/science.ts`).

## Reference solutions

`src/reference/solver.ts` solves every task with the agent's built-in tools only. It reads policy.md (`src/reference/policy.ts` reads the rules back from any of the three styles), sends one piece of code to `run` (`src/reference/code.ts`) that finds the plate's export from plates.csv, finds the plate, well and reading columns by their names, reads each reading as a number only when it is one, works out the controls, Z′, percent inhibition, calls and re-tests, and then appends any rows. It knows nothing about one lab or one instrument. Every task takes at most three tool calls and well under 24,000 characters of tool results.

## Tests

- The committed folder matches the generator byte for byte, and the same seeds always give the same bytes.
- The four labs differ in every number and code, the taught labs use all three policy styles, both hit rules and both replicate rules, and the lab never seen has a hit rule no taught lab uses.
- Each lab has its own date: every request states it, and every plate and queued request comes before it.
- The rules in policy.md, in every style, read back to the ones the lab was built with.
- Every export row reads back to its well's true signal, or to no reading; every well and compound id in compounds.csv reads back to one well and one compound; every date in plates.csv reads back to its day; and the share of values written another way stays in its range, none in the first rows.
- Z′, percent inhibition, the SD threshold, replicate calls and re-test needs match a plate worked by hand, both in the generator's science and in the reference's code.
- The checker passes the ground truth and other valid plans, and fails the common mistakes for the right reason: a value off, a number for a well with no reading, a missing or extra hit, hits on a failed plate, the wrong verdict, a wrong mean or call, re-tests over the cap, a compound already queued, compounds of a failed plate, a failed plate queued twice, a wrong reason, date or id, a changed old row, and a write from a task that only asks.
- The tasks split into the sizes the job asks for, with every family in one split.
- The reference solutions' calls are replayed through the engine's own tools on each lab's files, the text they get back is compared, and every task passes the engine's checker.

## Known gaps

- The job has not been calibrated on the bare student yet.
- Every lab runs inhibition assays read as a single signal; a lab that reports percent activity, or reads two channels, would need its own rules.

## Regenerate

```
pnpm --filter @architect/example-assay-desk generate
```
