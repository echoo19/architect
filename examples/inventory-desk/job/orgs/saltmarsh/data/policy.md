# Saltmarsh Institute Assay Lab stock rules

- `inventory.csv`: one row per lot of every compound we hold: compound_id, lot, location, quantity (what is left in the vial or well), conc_mm, received and expires.
- `reservations.csv`: stock already held for work not yet run, one row per lot held: reservation_id, compound_id, lot, amount, reserved_on. New reservations go at the end.

- Quantities: in nL. A quantity is written with its unit, µL, mL or nL (1 mL = 1,000 µL = 1,000,000 nL); most rows use ours, some older ones another.
- Dates: day-month-year, as 05-Nov-2026.
- Each re-test takes 5000 nL.
- A lot's free volume is its quantity less every amount reservations.csv holds on that lot.
- In date: the lot expires at least 60 days after the day of the request.
- A re-test may be made up from several lots. Every lot that is in date and has free volume is usable; take from them in order, everything free from each until the re-test has 5000 nL, and from the last only what is still needed.
- Draw from the lot that expires first first.
- Usable: the free volume of the usable lots together.
- Limit: a compound with 4 reservations already in reservations.csv gets no new one, whatever its lots, reason LIMIT.
- A compound that has no lot in date gets reason OUT-OF-DATE; one with lots in date that can't make up a re-test gets reason SHORT.
- New rows in reservations.csv: reservation_id numbered on from the last row, compound_id, lot, amount (in our unit, the number and the unit, as the file writes them), and reserved_on, the day of the request written the way we write dates. One row per lot drawn from, and none for a compound with nothing to draw.
