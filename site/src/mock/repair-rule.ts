/**
 * The repair shop's rule as the Define screen shows it. The shop is made up (a bike repair desk and
 * its three files); the rule is the one Spark drafted from those files, and the words are the app's
 * own, read from the draft's record the way the app reads it today: the steps as the rule's steps
 * are told, the worked lines in the plainer words an older draft is read in. Nothing here is
 * written for the page. It is kept apart from the mock so a test can check that the numbers work.
 */

export const JOB_NAME = 'Repair ticket cost helper';
/** The kind of task the rule is for, as the screen titles it. */
export const RULE_LABEL = 'Ticket costs';

/** A step of the rule: its words, the files it names in brackets, and what the person said. */
export interface RuleStep {
  text: string;
  /** Files named in brackets in the text, which the screen sets quietly. */
  files?: readonly string[];
  /** What the person said it rests on, said beside the step. */
  note?: string;
}

export const RULE_STEPS: readonly RuleStep[] = [
  { text: 'Round labor hours up to a multiple of 0.5.' },
  { text: 'Multiply by 65.' },
  { text: 'When member (customers.csv) is yes, take 10% off.', files: ['customers.csv'] },
  { text: 'Add parts cost.', note: 'An empty parts cost counts as 0, as you said.' },
  { text: 'Round the result to the nearest cent; half a cent rounds up.' },
];

/** A piece of a step's words: plain, or a file's name in brackets, which is set quietly. */
export interface StepPiece {
  text: string;
  file: boolean;
}

/** A step's words cut around the files it names in brackets, so each can be set quietly. */
export function stepPieces({ text, files = [] }: RuleStep): StepPiece[] {
  if (files.length === 0) return [{ text, file: false }];
  const brackets = files.map((file) => `(${file})`);
  const escaped = brackets.map((bracket) => bracket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text
    .split(new RegExp(`(${escaped.join('|')})`))
    .filter((part) => part !== '')
    .map((part) => ({ text: part, file: brackets.includes(part) }));
}

/** One line of a worked example: a step of the working, and the number it came to. */
export interface WorkedLine {
  text: string;
  value: string;
}

export interface WorkedExample {
  request: string;
  answer: string;
  /** What the example read from the ticket's own record. */
  inputs: readonly { label: string; value: string }[];
  lines: readonly WorkedLine[];
}

/**
 * One example from the draft: ticket T-2014, a member's, which Architect chose from the shop's own
 * practice records. Its three inputs are the ticket's and its customer's own cells, and each line
 * is a step of the working with the number it came to.
 */
export const EXAMPLE: WorkedExample = {
  request: 'What does ticket T-2014 cost the customer?',
  answer: '$292.50',
  inputs: [
    { label: 'labor hours', value: '5' },
    { label: 'parts cost', value: '0' },
    { label: 'member (customers.csv)', value: 'yes' },
  ],
  lines: [
    { text: 'Labor hours (5), rounded up to a multiple of 0.5', value: '5' },
    { text: '5 times 65', value: '325' },
    { text: '325 times 0.9', value: '292.5' },
    { text: 'Member (customers.csv) is yes, so use 292.5', value: '292.5' },
    { text: '292.5 plus parts cost (0)', value: '292.5' },
    { text: '292.5, rounded to the nearest cent, half a cent rounds up', value: '292.5' },
  ],
};
