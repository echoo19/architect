/** Every word and link the pages say, in the order they appear. */

export const REPO = 'https://github.com/echoo19/architect';
/** The release page, with every installer on it. */
export const RELEASES = `${REPO}/releases/latest`;
/**
 * The Windows installer, which a visitor on Windows is sent to directly. Its name carries the
 * app's version, and a test keeps this one in step with it.
 */
export const APP_VERSION = '0.6.1';
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
 * The specialists Architect has made, named under the film as plain links: to their figures on
 * the results page where there are some, and to the README's list otherwise.
 */
export const SPECIALISTS = {
  made: [
    { name: 'Returns desk', to: 'results', anchor: 'results' },
    { name: 'Service desk', to: 'readme' },
    { name: 'Academy desk', to: 'results', anchor: 'field' },
  ],
  next: [
    { name: 'Sweep desk', to: 'readme' },
    { name: 'Assay desk', to: 'readme' },
  ],
} as const;
/** The README's list of what Architect makes. */
export const README_SPECIALISTS = `${REPO}#what-you-can-make-with-it`;

/**
 * Why Architect exists, under the film: our reason, then the three requests from Y Combinator that
 * came out after the build began and ask for the same thing. Each quote is one sentence, verbatim,
 * linked to its request.
 */
export const WHY = {
  title: 'Why we made this',
  reason:
    "Most teams that build with AI rent it, and every request sends their data to someone else's model. Architect works the other way round: a large model teaches a small one the work and then leaves. What's left runs on the team's own computer and comes with a record of what it can and can't do.",
  after:
    "We started building Architect on October 27, 2026. Y Combinator's Requests for Startups for Winter 2027 came out after that, and three of them ask for what we were already making.",
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
        'In Architect, every field ends with a checker that gives the same answer every time. It is exported as a reward a training framework can call, along with training examples the checker verified and sealed tests the model never saw. No large model has been trained with them yet.',
    },
  ],
} as const;

export const FOOTER = {
  licence: 'Open source under the MIT licence.',
  author: 'Made by Jake Kang.',
  /** The home page's note: which parts of the pictures are real. */
  note: "Both shops are made up. The returns desk's training rounds, scores and final test are from a real run, and so are the repair shop's rule and its run. The chats, the correction and the Hugging Face page are written from the same records to show the screens.",
  /** The results page's note. */
  resultsNote:
    'The generated academies, the returns desks and the repair shop are made up. The Real academy is a real one, anonymized, and its records are not published. The figures are from real runs, and the reports they come from are in docs/comparisons.',
} as const;
