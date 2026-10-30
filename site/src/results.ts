/**
 * The measured results the page shows under the report. They are the figures of comparison 2 in
 * docs/comparisons, given as the full reports give them, and they are kept apart from the rest of
 * the copy so they are changed from the real runs and nowhere else. Say no more than the numbers
 * say: no "always", and no percentage the reports do not state.
 */

export interface ResultRow {
  label: string;
  passed: number;
  total: number;
  /** The row that is Glimmer after teaching, drawn in Glimmer's color. */
  taught?: boolean;
}

export interface Finding {
  /** The number that matters, as it is read at a glance. */
  figure: string;
  /** One plain sentence, or two. */
  text: string;
}

export interface Results {
  title: string;
  /** What the figures are, and what they are not. */
  scope: string;
  rows: readonly ResultRow[];
  /** The job's target, as a share of the test. */
  target: number;
  findings: readonly Finding[];
  /** The words of the link to the full reports. */
  reports: string;
}

/**
 * What the repair shop's run showed. It is one run of one drafted job, on an online copy of
 * Glimmer, and not a planned comparison, which the sentence says. The figures are the run's own
 * record, and the README gives the same: 22 of 30 check tasks before any teaching, one round of
 * teaching, and 40 of 40 on the final test.
 */
export const REPAIR_RUN =
  "On the repair shop's pricing, an online copy of Glimmer got 22 of 30 check tasks before teaching. After one round of teaching it got 40 of 40 on its final test, graded by the rule the shop confirmed. That was a single run, not a planned comparison.";

export const RESULTS: Results = {
  title: 'Measured results',
  scope:
    "One made-up business, a returns desk, measured with Glimmer served online on 60 requests it had never seen. The smaller build that runs on your computer has not taken this test. The mark on each bar is the job's target, 95%.",
  rows: [
    { label: 'Glimmer on its own', passed: 44, total: 60 },
    { label: "Spark's setup, written without watching Glimmer", passed: 38, total: 60 },
    { label: "Glimmer after Spark's teaching", passed: 58, total: 60, taught: true },
  ],
  target: 0.95,
  findings: [
    {
      figure: '+15, -1',
      text: "Request by request, teaching fixed 15 of Glimmer's misses and broke 1 of its right answers.",
    },
    {
      figure: '3.5 s',
      text: 'On the online copy, a typical answer took 3.5 s after teaching, against 17.7 s before.',
    },
    {
      figure: '42 cents',
      text: 'Teaching cost 42 cents of Spark: 34 for the rounds and 8 for its first setup.',
    },
    {
      figure: '38 of 60',
      text: 'The setup Spark wrote without watching Glimmer scored below Glimmer alone. The gain came from the rounds where Spark watched Glimmer fail.',
    },
    { figure: '40 of 40', text: REPAIR_RUN },
    {
      figure: 'No gain',
      text: 'An earlier comparison, with teaching held to two rounds on another returns desk, showed no clear gain.',
    },
  ],
  reports: 'Read the full reports',
};
