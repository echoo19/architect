/** Every word and link the pages say, in the order they appear. */

export const REPO = 'https://github.com/echoo19/architect';
/** The release page, with every installer on it. */
export const RELEASES = `${REPO}/releases/latest`;
/**
 * The Windows installer, which a visitor on Windows is sent to directly. Its name carries the
 * app's version, and a test keeps this one in step with it.
 */
export const APP_VERSION = '0.4.0';
export const WINDOWS_INSTALLER = `${RELEASES}/download/Architect-Setup-${APP_VERSION}.exe`;
/** The Mac disk images, one for Apple silicon and one for Intel, named by the same version. */
export const MAC_DMG = `${RELEASES}/download/Architect-${APP_VERSION}-arm64.dmg`;
export const MAC_INTEL_DMG = `${RELEASES}/download/Architect-${APP_VERSION}-x64.dmg`;
/** The full reports behind the measured results. */
export const REPORTS = `${REPO}/tree/main/docs/comparisons`;

export const HERO = {
  title: 'Describe a job. Get an agent that runs on your computer.',
  /** Two sentences, each on its own line where there is room. */
  line: [
    'Spark, a large model, teaches your job to Glimmer, a small one.',
    'Once Glimmer passes a test it has never seen, it runs offline on your files.',
  ],
} as const;

/** The walkthrough film under the first screen's words. Its files are in public/. */
export const FILM = {
  src: './architect-film.mp4',
  poster: './film-poster.jpg',
  label: 'A walkthrough of Architect, with narration: 2 minutes 50 seconds.',
  play: 'Play the walkthrough, 2 minutes 50 seconds, with sound',
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
