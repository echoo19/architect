# How Alder Row Biosciences reads a plate

This is how we go from a plate reader export to calls and re-tests. Each plate is judged against its own controls, never against another plate.

- `plates.csv`: every plate we read: its layout, the instrument, the day it was read and the export file that holds its wells.
- Each instrument's export, the file plates.csv names for a plate: every instrument writes its own columns and its own way of naming a well.
- `compounds.csv`: the well map: which compound, or which control, sits in each well of each plate.
- `retests.csv`: the re-test queue. New requests go at the end.

Negative control wells hold vehicle only and count as 0% inhibition; compounds.csv gives them the compound_id NEG. Positive control wells hold the reference inhibitor and count as 100% inhibition; their compound_id is POS.

A well whose export shows no number (left blank, a dash, NaN, or an overflow flag such as OVRFLW) has no reading. Leave it out of every mean, standard deviation and call.

percent inhibition = 100 × (mean of the negative controls − the well's signal) / (mean of the negative controls − mean of the positive controls), with the plate's own control wells that have a reading.

Z′ = 1 − 3 × (SD of the positive controls + SD of the negative controls) / |mean of the positive controls − mean of the negative controls|, on the plate's raw signals, with the sample standard deviation (divide by n − 1).

We pass a plate when its Z′ is 0.4 or higher. A plate below that gets no hit calls; the whole plate goes back for a re-test.

A compound is a hit when its percent inhibition is at least 3 standard deviations above the negative controls' mean, the standard deviation taken over the negative control wells' own percent inhibition (their mean is 0).

A compound run in more than one well is a hit only when every one of its wells reaches the threshold. If any well of a compound has no reading, or its wells differ by more than fifteen points of percent inhibition (highest minus lowest), the compound is inconclusive, neither a hit nor inactive.

A compound that isn't inconclusive is borderline when the mean of its wells sits less than five points from the hit threshold, above or below it. A borderline hit is still a hit; it is re-tested to confirm.

Re-tests are queued in retests.csv, one row each: retest_id numbered on from the last row, plate_id, compound_id (left empty for a whole plate), reason, and requested_on, the day of the request as YYYY-MM-DD.

A failed plate gets a single row for the whole plate with the reason qc, and none for its compounds. On a plate that passes, we re-test inconclusive compounds (reason rep) and borderline ones (reason edge), but no more than three compounds per plate; when more qualify, any three of them will do. Never request what retests.csv already holds for that plate: a plate already queued whole, or a compound already queued on it.
