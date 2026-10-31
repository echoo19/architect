# Saltmarsh Institute Assay Lab plate rules

- `plates.csv`: every plate we read: its layout, the instrument, the day it was read and the export file that holds its wells.
- Each instrument's export, the file plates.csv names for a plate: every instrument writes its own columns and its own way of naming a well.
- `compounds.csv`: the well map: which compound, or which control, sits in each well of each plate.
- `retests.csv`: the re-test queue. New requests go at the end.

- Negative control: compound_id HI, 0% inhibition.
- Positive control: compound_id LO, 100% inhibition.
- A well whose export shows no number (left blank, a dash, NaN, or an overflow flag such as OVRFLW) has no reading. Leave it out of every mean, standard deviation and call.
- percent inhibition = 100 × (mean of the negative controls − the well's signal) / (mean of the negative controls − mean of the positive controls), with the plate's own control wells that have a reading.
- Z′ = 1 − 3 × (SD of the positive controls + SD of the negative controls) / |mean of the positive controls − mean of the negative controls|, on the plate's raw signals, with the sample standard deviation (divide by n − 1).
- QC: a plate passes at Z′ >= 0.6. A failed plate gets no hit calls and is re-tested whole.
- Hit: percent inhibition of 40% or more.
- Replicates: call a compound on the mean of its wells.
- Inconclusive: any well of the compound has no reading, or its wells differ by more than 25 points (highest minus lowest). Neither a hit nor inactive.
- Borderline: not inconclusive, and the mean of its wells is less than 8 points from the hit threshold, either side. A borderline hit is still a hit.
- Re-test rows in retests.csv: retest_id numbered on from the last row, plate_id, compound_id (empty for a whole plate), reason, requested_on (the day of the request, YYYY-MM-DD).
- Failed plate: one row for the whole plate, reason PLATE; none for its compounds.
- Passing plate: re-test inconclusive compounds (reason SPLIT) and borderline ones (reason NEAR), at most 6 per plate; when more qualify, any 6 will do.
- Never request what retests.csv already holds for the plate: a plate queued whole, or a compound already queued on it.
