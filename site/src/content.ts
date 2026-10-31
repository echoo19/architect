/** Every word and link the pages say, in the order they appear. */

export const REPO = 'https://github.com/echoo19/architect';
/** The release page, with every installer on it. */
export const RELEASES = `${REPO}/releases/latest`;
/**
 * The Windows installer, which a visitor on Windows is sent to directly. Its name carries the
 * app's version, and a test keeps this one in step with it.
 */
export const APP_VERSION = '0.7.0';
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
    'A large model teaches a small one by rewriting its instructions and tools.',
    'Every change is tested on work neither model has seen, and Architect certifies when the result can be trusted.',
  ],
} as const;

/** The walkthrough film under the first screen's words. Its file is in public/. */
export const FILM = {
  src: './architect-film.mp4',
  label: 'A walkthrough of Architect, with narration: 2 minutes 50 seconds.',
  play: 'Play the walkthrough, 2 minutes 50 seconds, with sound',
} as const;

/**
 * Why Architect exists, under the film: our reason, then the three requests from Y Combinator that
 * came out after the build began and ask for the same thing. Each quote is one sentence, verbatim,
 * linked to its request, and each answer is two sentences at most.
 */
export const WHY = {
  title: 'Why we made this',
  reason:
    "Most teams that build with AI rent it, and every request sends their data to someone else's model. Architect works the other way round: a large model teaches a small one the work and then leaves. What's left runs on the team's own computer and comes with a record of what it can and can't do.",
  /** One line under the title: when the build began, against when the requests came out. */
  started: 'Started Oct 27, 2026, before these YC requests came out.',
  requests: [
    {
      title: 'Own Your Intelligence',
      author: 'Jon Xu',
      href: 'https://www.ycombinator.com/rfs#own-your-intelligence',
      quote:
        'Someone has to turn workflows into evals, expertise into training data, production failures into improvements, and carry all of it forward with each new base model.',
      answer:
        "In Architect, a field's checks come from its workflow, and its verified examples from the organization's own material. Each failure becomes a logged change to the agent, and the same field can be taught again on a new base model.",
    },
    {
      title: 'AI for the Air-Gapped Economy',
      author: 'Brad Flora',
      href: 'https://www.ycombinator.com/rfs#ai-for-the-air-gapped-economy',
      quote: "The most valuable data in the world isn't in the cloud.",
      answer:
        "What Architect makes runs on the organization's own computer. It makes no network calls except to the model running beside it, and a test checks that.",
    },
    {
      title: 'Vertical Foundation Models',
      author: 'Diana Hu',
      href: 'https://www.ycombinator.com/rfs#vertical-foundation-models',
      quote: 'The hard part is getting high-quality, vertical-specific, verifiable rewards.',
      answer:
        'Every field ends with a checker that always gives the same answer, and Architect exports it as a reward a training framework can call, with verified examples and sealed tests beside it. No large model has been trained with them yet.',
    },
  ],
} as const;

export const FOOTER = {
  licence: 'Open source under the MIT licence.',
  author: 'Made by Jake Kang.',
  /** The home page's note: which parts of the film are real. */
  note: 'The shops and academies in the film are generated, except the anonymized Real academy. Every measured figure is from a real run.',
  /** The results page's note. */
  resultsNote:
    'The generated academies, the returns desks and the repair shop are made up. The Real academy is a real one, anonymized, and its records are not published. The figures are from real runs, and the reports they come from are in docs/comparisons.',
} as const;
