import { createContext, useContext } from 'react';

/**
 * The words the film's screens use for a few of the product's concepts. The walkthrough keeps the
 * words it was recorded with; the launch film sets the app's newer ones around the same screens.
 */
export interface Labels {
  /** An experiment's arms, by id. */
  arms: Readonly<Record<'bare' | 'draft' | 'taught', string>>;
  /** The tasks a change is measured on, which the teacher never sees. */
  checks: string;
  /** The version panel's statement of how often the version is wrong. */
  certificate: string;
  /** The Fields table's heading over its final-test columns. */
  bestFinalTest: string;
}

export const WALKTHROUGH_LABELS: Labels = {
  arms: { bare: 'Glimmer alone', draft: 'One-shot setup', taught: 'Taught by Spark' },
  checks: 'check tasks',
  certificate: 'Certified answers',
  bestFinalTest: 'Best final test',
};

export const LabelsContext = createContext<Labels>(WALKTHROUGH_LABELS);

export const useLabels = () => useContext(LabelsContext);
