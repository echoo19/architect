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
  /** One short line under the bar, where the figure needs it. */
  note?: string;
}

export interface Results {
  title: string;
  /** What the figures are, and what they are not. */
  scope: string;
  /** The test every row took. */
  test: string;
  rows: readonly ResultRow[];
  /** What else the run showed, one plain sentence each. */
  findings: readonly string[];
  /** The result of the comparison that came before it, in one plain sentence. */
  earlier: string;
  /** The words of the link to the full reports. */
  reports: string;
}

export const RESULTS: Results = {
  title: 'Measured results',
  scope:
    'These numbers are from the run shown above: one made-up business, a returns desk, measured with Glimmer served online. The smaller build that runs on your computer has not taken this test.',
  test: '60 requests it had never seen',
  rows: [
    { label: 'Glimmer on its own', passed: 44, total: 60 },
    {
      label: "Glimmer after Spark's teaching",
      passed: 58,
      total: 60,
      note: "The job's target was 95%.",
    },
    { label: "Spark's setup, written without watching Glimmer", passed: 38, total: 60 },
  ],
  findings: [
    "Request by request, teaching fixed 15 of Glimmer's misses and broke 1 of its right answers.",
    'On the online copy, a typical answer took 3.5 s after teaching, against 17.7 s before.',
    'The setup Spark wrote without watching Glimmer scored below Glimmer alone. The gain came from the rounds where Spark watched Glimmer fail.',
    'Teaching cost 42 cents of Spark: 34 for the rounds and 8 for its first setup.',
  ],
  earlier:
    'An earlier comparison, with teaching held to two rounds on another returns desk, showed no clear gain.',
  reports: 'Read the full reports',
};
