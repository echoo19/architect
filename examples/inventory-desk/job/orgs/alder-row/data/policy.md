# How Alder Row Biosciences draws stock for a re-test

This is how we pick the lot of a compound a re-test comes from, and how we hold it until the plate is run.

- `inventory.csv`: one row per lot of every compound we hold: compound_id, lot, location, quantity (what is left in the vial or well), conc_mm, received and expires.
- `reservations.csv`: stock already held for work not yet run, one row per lot held: reservation_id, compound_id, lot, amount, reserved_on. New reservations go at the end.

We write quantities in mL. A quantity is written with its unit, µL, mL or nL (1 mL = 1,000 µL = 1,000,000 nL); most rows use ours, some older ones another. Dates are written month/day/year, as 10/21/2026.

Each re-test takes 0.015 mL of stock. A lot's free volume is its quantity less every amount reservations.csv holds on that lot. A lot is in date for a re-test only when it expires at least fourteen days after the day of the request.

A re-test may be made up from several lots. Every lot that is in date and has free volume is usable; take from them in order, everything free from each until the re-test has 0.015 mL, and from the last only what is still needed. We draw from the lot with the most free volume first. How much of a compound is usable is the free volume of its usable lots together.

First, whether a re-test can be drawn at all: a compound that has no lot in date gets reason exp; one with lots in date that can't make up a re-test gets reason low. A re-test that can be drawn is allocated and reserved only if the compound's rows in reservations.csv, with one new row for each lot drawn, come to no more than two; otherwise it gets reason cap and no row.

New rows in reservations.csv: reservation_id numbered on from the last row, compound_id, lot, amount (in our unit, the number and the unit, as the file writes them), and reserved_on, the day of the request written the way we write dates. One row per lot drawn from, and none for a compound with nothing to draw.
