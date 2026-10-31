# Fenwick Screening Core: drawing stock for a re-test

How we decide which lot of a compound a re-test comes from, and how we hold it. The numbers are in the table at the end.

## Our records

- `inventory.csv`: one row per lot of every compound we hold: compound_id, lot, location, quantity (what is left in the vial or well), conc_mm, received and expires.
- `reservations.csv`: stock already held for work not yet run, one row per lot held: reservation_id, compound_id, lot, amount, reserved_on. New reservations go at the end.

A quantity is written with its unit, µL, mL or nL (1 mL = 1,000 µL = 1,000,000 nL); most rows use ours, some older ones another.

## What can be used

A lot's free volume is its quantity less every amount reservations.csv holds on that lot. A lot is in date for a re-test when it expires at least the days in the table after the day of the request; a lot that expires sooner, or has expired, is not used.

When the table says lots are not combined, a re-test comes from a single lot: a lot is usable when it is in date and has at least the stock per re-test free. Draw the stock per re-test from the first usable lot.

The lots go in the order the table says to draw from: the one that expires first, or the one with the most free volume. How much of a compound is usable is the free volume of its usable lots together.

## Reservations

First, whether a re-test can be drawn at all: a compound with no lot in date gets the no-lot-in-date code, and one with lots in date that cannot make up a re-test gets the too-little code. A re-test that can be drawn is allocated and reserved only if the compound's rows in reservations.csv, with one new row for each lot drawn, come to no more than the reservations per compound in the table; otherwise it gets the reservation-limit code and no row.

New rows in reservations.csv: reservation_id numbered on from the last row, compound_id, lot, amount (in our unit, the number and the unit, as the file writes them), and reserved_on, the day of the request written the way we write dates. One row per lot drawn from, and none for a compound with nothing to draw.

| Setting | Value |
| --- | --- |
| Quantities written in | µL |
| Dates written as | year-month-day, as 2026-10-14 |
| Stock per re-test | 20 µL |
| Days a lot must have left before it expires, at least | 30 |
| Lot to draw from first | the lot that expires first |
| Combine lots for one re-test | no |
| Reservations per compound, at most | 3 |
| Reason code, no lot in date | EXPIRED |
| Reason code, too little stock | LOW-VOLUME |
| Reason code, reservation limit reached | MAX-HOLDS |
