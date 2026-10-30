/** Every word and link the page says outside the mocks, in the order it appears. */

export const REPO = 'https://github.com/echoo19/architect';
/** The release page, with every installer on it. */
export const RELEASES = `${REPO}/releases/latest`;
/**
 * The Windows installer, which a visitor on Windows is sent to directly. Its name carries the
 * app's version, and a test keeps this one in step with it.
 */
export const APP_VERSION = '0.4.0';
export const WINDOWS_INSTALLER = `${RELEASES}/download/Architect-Setup-${APP_VERSION}.exe`;
/** The full reports behind the measured results. */
export const REPORTS = `${REPO}/tree/main/docs/comparisons`;

export const HERO = {
  title: 'Describe a job. Get an agent that runs on your computer.',
  /** Two sentences, each on its own line where there is room. */
  line: [
    'Spark, a large model, teaches Glimmer, a small one that fits on a PC.',
    'Glimmer then works on your files, offline, on your own computer.',
  ],
} as const;

export type ChapterId = 'describe' | 'ask' | 'rule' | 'train' | 'test' | 'use' | 'teach' | 'share';

export interface ChapterCopy {
  id: ChapterId;
  /** The claim, as a heading. */
  title: string;
  /** One line under it. The names Spark and Glimmer are set in their own colors. */
  body: string;
}

export const CHAPTERS: readonly ChapterCopy[] = [
  {
    id: 'describe',
    title: 'Describe the job in your own words.',
    body: 'Say what you need done and attach the files it works from.',
  },
  {
    id: 'ask',
    title: 'Spark asks what your files leave open.',
    body: "Where your records or your policy don't settle something, it asks before it guesses.",
  },
  {
    id: 'rule',
    title: 'Nothing trains until you confirm the rule.',
    body: 'Spark turns your pricing into steps and works one of your own records through them. You check it, then confirm.',
  },
  {
    id: 'train',
    title: 'It learns by trying, and keeps only what works.',
    body: 'Spark finds where Glimmer slips and changes its instructions. A change stays only if the score goes up on check tasks Spark never sees.',
  },
  {
    id: 'test',
    title: 'Then it takes a test it has never seen.',
    body: 'Spark is disconnected. Glimmer answers new tasks once, and you see how it did on each kind.',
  },
  {
    id: 'use',
    title: 'Put it to work on your computer.',
    body: 'It reads your files and asks before it changes one.',
  },
  {
    id: 'teach',
    title: 'Correct it when it is wrong.',
    body: 'Flag an answer and Spark turns it into a lesson. Save it as a new version; the old one keeps answering until you switch.',
  },
  {
    id: 'share',
    title: 'Hand it to someone else.',
    body: 'Publish it to Hugging Face, private by default, or export one file. Install it and run it from a terminal. Your keys and chats stay on your computer.',
  },
];

export interface Requirement {
  name: string;
  text: string;
}

export const CLOSING = {
  title: 'Get Architect.',
  /** What a first run asks for, in the README's words. */
  needs: [
    { name: 'Ollama', text: 'Runs Glimmer on your computer.' },
    {
      name: 'Glimmer',
      text: 'The first screens download it: 17 GB, or 14 GB for a 12 GB graphics card.',
    },
    { name: 'Spark', text: 'The first screens connect it with an API key from Meta.' },
    {
      name: 'Opening it',
      text: "The app isn't signed yet. On Windows choose More info, then Run anyway. On a Mac, right-click it and choose Open.",
    },
  ] satisfies readonly Requirement[],
  github: 'View the code on GitHub',
} as const;

export const FOOTER = {
  licence: 'Open source under the MIT licence.',
  author: 'Made by Jake Kang.',
  /** The home page's note: which parts of the pictures are real. */
  note: "Both shops are made up. The returns desk's training rounds, scores and final test are from a real run, and so are the repair shop's rule and its run. The chats, the correction and the Hugging Face page are written from the same records to show the screens.",
  /** The results page's note. */
  resultsNote:
    'The returns desks and the repair shop are made up. The figures are from real runs, and the reports they come from are in docs/comparisons.',
} as const;
