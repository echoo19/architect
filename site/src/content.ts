/** Every word and link the page says outside the mocks, in the order it appears. */

export const REPO = 'https://github.com/echoo19/architect';
/** The release page, with every installer on it. */
export const RELEASES = `${REPO}/releases/latest`;
/**
 * The Windows installer, which a visitor on Windows is sent to directly. Its name carries the
 * app's version, and a test keeps this one in step with it.
 */
export const APP_VERSION = '0.3.0';
export const WINDOWS_INSTALLER = `${RELEASES}/download/Architect-Setup-${APP_VERSION}.exe`;
/** The full reports behind the measured results. */
export const REPORTS = `${REPO}/tree/main/docs/comparisons`;

export const HERO = {
  eyebrow: 'Open source, for Windows and macOS',
  title: 'Describe a job. Get an agent that runs on your computer.',
  /** Two sentences, each on its own line where there is room. */
  line: [
    'Spark, a large model, teaches Glimmer, a small one that fits on a PC.',
    'Glimmer then works on your files, offline, on your own computer.',
  ],
} as const;

export type ChapterId = 'describe' | 'train' | 'test' | 'use' | 'teach' | 'share';

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
    body: 'Attach its files. Spark asks about anything unclear, then drafts the job with you.',
  },
  {
    id: 'train',
    title: 'It learns by trying and keeps only what works.',
    body: 'Spark finds where Glimmer goes wrong and changes its instructions. A change stays only if the score goes up enough on check tasks that Spark never sees.',
  },
  {
    id: 'test',
    title: 'Then it takes a test it has never seen.',
    body: 'Spark is disconnected. Glimmer answers new tasks once, and you see how it did on each type of task.',
  },
  {
    id: 'use',
    title: 'Put it to work on your computer.',
    body: 'It reads your files and asks before it changes one.',
  },
  {
    id: 'teach',
    title: 'Correct it when it is wrong.',
    body: 'Flag an answer and Spark turns it into a lesson. Save it as a new version, and the old one keeps answering until you use the new one.',
  },
  {
    id: 'share',
    title: 'Hand it to someone else.',
    body: 'Export one file, or publish a private repository on Hugging Face. Your keys and chats stay on your computer.',
  },
];

export const CLOSING = {
  title: 'Get Architect.',
  /** What a first run asks for, in the README's words. */
  needs:
    "You'll need Ollama. The first screens download Glimmer (17 GB, or 14 GB for a 12 GB graphics card) and connect Spark with an API key from Meta. The app isn't signed yet: on Windows choose More info, then Run anyway; on a Mac, right-click it and choose Open.",
  github: 'View the code on GitHub',
} as const;

export const FOOTER = {
  licence: 'Open source under the MIT licence.',
  author: 'Made by Jake Kang.',
  note: 'The returns desk is a made-up shop. Its training run, its results and the October orders answer are real; the other requests shown are written from its records.',
} as const;
