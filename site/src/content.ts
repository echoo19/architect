/** Every word and link the pages say, in the order they appear. */

export const REPO = 'https://github.com/echoo19/architect';
/** The release page, with every installer on it. */
export const RELEASES = `${REPO}/releases/latest`;
/**
 * The Windows installer, which a visitor on Windows is sent to directly. Its name carries the
 * app's version, and a test keeps this one in step with it.
 */
export const APP_VERSION = '0.9.1';
export const WINDOWS_INSTALLER = `${RELEASES}/download/Architect-Setup-${APP_VERSION}.exe`;
/** The Mac disk images, one for Apple silicon and one for Intel, named by the same version. */
export const MAC_DMG = `${RELEASES}/download/Architect-${APP_VERSION}-arm64.dmg`;
export const MAC_INTEL_DMG = `${RELEASES}/download/Architect-${APP_VERSION}-x64.dmg`;
/** The full reports behind the measured results. */
export const REPORTS = `${REPO}/tree/main/docs/comparisons`;

export const HERO = {
  title: 'The training system for your own AI.',
  /** Two sentences, each on its own line where there is room. */
  line: [
    'A frontier model trains a specialist on your work through harness engineering and LoRA fine-tuning, and judges it on tests sealed from both.',
    'Then it runs on your own hardware, fully offline. Your data stays yours, and so does the AI.',
  ],
} as const;

/** The walkthrough film under the first screen's words. Its files are in public/. */
/** A film the site plays behind a still cover. */
export interface FilmSource {
  src: string;
  /** A still from the film, shown until it plays. */
  cover: string;
  label: string;
  play: string;
}

export const FILM = {
  src: './architect-film.mp4',
  /** A still of the Lab from the film, shown until it plays. */
  cover: './architect-film-cover.webp',
  label: 'A walkthrough of Architect, with narration: 2 minutes 50 seconds.',
  play: 'Play the walkthrough, 2 minutes 50 seconds, with sound',
} as const satisfies FilmSource;

/**
 * The wind farm desk's run, recorded in the app as it ran (docs/comparisons/edge-1.md), cut to
 * music with its waits shown faster. The results page shows it, from a folder below the root.
 */
export const EDGE_FILM = {
  src: '../edge-1-film.mp4',
  cover: '../edge-1-film-cover.webp',
  label: 'A real run of Architect, recorded: 1 minute 11 seconds, with music.',
  play: 'Play the recorded run, 1 minute 11 seconds, with music',
} as const satisfies FilmSource;

/** Why Architect exists, under the film: when the build began and our reason. */
export const WHY = {
  title: 'Why we made this',
  reason:
    "Most teams rent their AI, and every request sends their data to someone else's model. With Architect, a large model teaches a small one the work and leaves. What's left is the team's own.",
  /** One line under the title: when the build began. */
  started: 'Started Oct 27, 2026.',
} as const;

export const FOOTER = {
  licence: 'Open source under the MIT licence.',
  author:
    'Idea and orchestration by Jake Kang, with Claude Code on Claude Opus 5.5 and Codex on GPT-6 Astra as the dev team.',
  /** The home page's note: which parts of the film are real. */
  note: 'The shops, labs and academies in the film are generated, except the anonymized Real academy. Every measured figure is from a real run.',
  /** The results page's note. */
  resultsNote:
    "The generated academies, the screening labs, the returns desks and the repair shop are made up. The Real academy is a real one, anonymized, and its records are not published. The figures are from real runs. Each comparison has its report in docs/comparisons. The repair shop was the film's demo run, recorded in HACKATHON.md, and the 2,312-row repair is in DECISIONS.md.",
} as const;
