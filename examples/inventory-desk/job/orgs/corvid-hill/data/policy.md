# Corvid Hill Discovery stock rules

- `inventory.csv`: one row per lot of every compound we hold: compound_id, lot, location, quantity (what is left in the vial or well), conc_mm, received and expires.
- `reservations.csv`: stock already held for work not yet run, one row per lot held: reservation_id, compound_id, lot, amount, reserved_on. New reservations go at the end.

- Quantities: in µL. A quantity is written with its unit, µL, mL or nL (1 mL = 1,000 µL = 1,000,000 nL); most rows use ours, some older ones another.
- Dates: year-month-day, as 2026-10-28.
- Each re-test takes 12 µL.
- A lot's free volume is its quantity less every amount reservations.csv holds on that lot.
- In date: the lot expires at least 21 days after the day of the request.
- A re-test comes from a single lot. A lot is usable when it is in date and has at least 12 µL free; draw 12 µL from the first usable lot.
- Draw from the lot with the most free volume first.
- Usable: the free volume of the usable lots together.
- First, whether a re-test can be drawn at all: a compound that has no lot in date gets reason EXPIRING; one with lots in date that can't make up a re-test gets reason INSUFFICIENT.
- Limit: A re-test that can be drawn is allocated and reserved only if the compound's rows in reservations.csv, with one new row for each lot drawn, come to no more than 5; otherwise it gets reason HOLD-LIMIT and no row.
- New rows in reservations.csv: reservation_id numbered on from the last row, compound_id, lot, amount (in our unit, the number and the unit, as the file writes them), and reserved_on, the day of the request written the way we write dates. One row per lot drawn from, and none for a compound with nothing to draw.
