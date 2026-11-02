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
    'It runs on-premise and offline, and can carry a risk certificate: a statistical bound on how often it is wrong.',
  ],
} as const;

/** The walkthrough film under the first screen's words. Its files are in public/. */
export const FILM = {
  src: './architect-film.mp4',
  /** A still of the Lab from the film, shown until it plays. */
  cover: './architect-film-cover.webp',
  label: 'A walkthrough of Architect, with narration: 2 minutes 41 seconds.',
  play: 'Play the walkthrough, 2 minutes 41 seconds, with sound',
} as const;

/**
 * Why Architect exists, under the film: our reason, then the three requests from Y Combinator that
 * came out after the build began and ask for the same thing. Each quote is one sentence, verbatim,
 * linked to its request, and each answer is a line or two.
 */
export const WHY = {
  title: 'Why we made this',
  reason:
    "Most teams rent their AI, and every request sends their data to someone else's model. With Architect, a large model teaches a small one the work and leaves. What's left is the team's own.",
  /** One line under the title: when the build began, against when the requests came out. */
  started: 'Started Oct 27, 2026, before these requests came out.',
  /** Where the requests come from, shown above them with its mark. */
  source: {
    title: 'Y Combinator Requests for Startups',
    season: 'Winter 2027',
    href: 'https://www.ycombinator.com/rfs',
  },
  requests: [
    {
      title: 'Own Your Intelligence',
      author: 'Jon Xu',
      href: 'https://www.ycombinator.com/rfs#own-your-intelligence',
      quote:
        'Someone has to turn workflows into evals, expertise into training data, production failures into improvements, and carry all of it forward with each new base model.',
      answer:
        "A field's checks come from its workflow, every failure becomes a logged change, and the field can be taught again on a new base model.",
    },
    {
      title: 'AI for the Air-Gapped Economy',
      author: 'Brad Flora',
      href: 'https://www.ycombinator.com/rfs#ai-for-the-air-gapped-economy',
      quote: "The most valuable data in the world isn't in the cloud.",
      answer:
        'What Architect makes runs on your own computer and calls nothing but the model beside it. A test checks that.',
    },
    {
      title: 'Vertical Foundation Models',
      author: 'Diana Hu',
      href: 'https://www.ycombinator.com/rfs#vertical-foundation-models',
      quote: 'The hard part is getting high-quality, vertical-specific, verifiable rewards.',
      answer:
        'Every field ends with a checker that exports as a reward a training framework can call. No large model has been trained with them yet.',
    },
  ],
} as const;

export const FOOTER = {
  licence: 'Open source under the MIT licence.',
  author: 'Made by Jake Kang.',
  /** The home page's note: which parts of the film are real. */
  note: 'The shops, labs and academies in the film are generated, except the anonymized Real academy. Every measured figure is from a real run.',
  /** The results page's note. */
  resultsNote:
    'The generated academies, the screening labs, the returns desks and the repair shop are made up. The Real academy is a real one, anonymized, and its records are not published. The figures are from real runs, and the reports they come from are in docs/comparisons.',
} as const;
