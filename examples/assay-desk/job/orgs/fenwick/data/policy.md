# Fenwick Screening Core: reading a screening plate

How we turn a plate reader export into calls and re-tests. Every plate is normalized to its own controls. The numbers are in the table at the end.

## Our records

- `plates.csv`: every plate we read: its layout, the instrument, the day it was read and the export file that holds its wells.
- Each instrument's export, the file plates.csv names for a plate: every instrument writes its own columns and its own way of naming a well.
- `compounds.csv`: the well map: which compound, or which control, sits in each well of each plate.
- `retests.csv`: the re-test queue. New requests go at the end.

## Controls and readings

Each plate carries negative control wells (no inhibitor, 0% inhibition) and positive control wells (the reference inhibitor, 100% inhibition). compounds.csv marks them by compound_id, with the codes in the table.

A well whose export shows no number (left blank, a dash, NaN, or an overflow flag such as OVRFLW) has no reading. Leave it out of every mean, standard deviation and call.

## Percent inhibition

percent inhibition = 100 × (mean of the negative controls − the well's signal) / (mean of the negative controls − mean of the positive controls), with the plate's own control wells that have a reading.

## Plate QC

Z′ = 1 − 3 × (SD of the positive controls + SD of the negative controls) / |mean of the positive controls − mean of the negative controls|, on the plate's raw signals, with the sample standard deviation (divide by n − 1).

A plate passes when its Z′ is at least the lowest passing Z′ in the table. A plate that fails gets no hit calls at all: the whole plate is re-tested.

## Hits and replicates

A compound is a hit when its percent inhibition reaches the hit threshold in the table.

A compound run in more than one well is called on the mean of its wells. A compound is inconclusive when any of its wells has no reading, or when its wells' percent inhibition differs by more than the agreement in the table (highest minus lowest). An inconclusive compound is neither a hit nor inactive.

A compound that is not inconclusive is borderline when the mean of its wells is less than the borderline band away from the hit threshold, on either side. Borderline hits stay hits; they are re-tested to confirm.

## Re-tests

Queue re-tests in retests.csv, one row each: retest_id numbered on from the last row, plate_id, compound_id (empty for a whole plate), reason, and requested_on, the day of the request as YYYY-MM-DD.

A failed plate gets one row for the whole plate, with the failed-plate code, and none for its compounds. On a plate that passes, re-test the inconclusive compounds and the borderline ones, with their codes, up to the most per plate in the table; when more qualify, any of them will do. Never request what retests.csv already holds for that plate: a plate already queued whole, or a compound already queued on it.

| Setting | Value |
| --- | --- |
| Negative control (0% inhibition) | DMSO |
| Positive control (100% inhibition) | STAU |
| Hit threshold | 50% inhibition |
| Lowest passing Z′ | 0.5 |
| Borderline band, points either side of the threshold | 10 |
| Replicates agree within, points | 20 |
| Call on replicates | mean of the wells |
| Compound re-tests per plate, at most | 4 |
| Reason code, failed plate | QC-FAIL |
| Reason code, borderline compound | BORDERLINE |
| Reason code, inconclusive compound | INCONCLUSIVE |
