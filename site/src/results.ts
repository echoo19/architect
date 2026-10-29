/**
 * The measured results the page shows under the report, kept apart from the rest of the copy so
 * they are filled in from the real runs and nowhere else. While `RESULTS` is `null` the page
 * shows a marked empty spot in their place.
 *
 * Each row is one way of doing the same final test: how many of its tasks it passed, out of how
 * many. Mark a row with `spark: true` when Spark did those tasks itself, and it gets Spark's
 * amber mark.
 */

export interface ResultRow {
  label: string;
  passed: number;
  total: number;
  spark?: boolean;
}

export interface Results {
  /** The job the numbers were measured on, in a few words. */
  job: string;
  rows: readonly ResultRow[];
}

export const RESULTS: Results | null = null;
