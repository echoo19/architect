/**
 * Others working on the same idea: published work from organizations people know that points
 * where Architect points (a better harness around a model, small specialized open models, data
 * that stays inside, checks that can be trusted). It is the same direction, not an endorsement:
 * none of them has seen or backed Architect, and the page never says otherwise.
 *
 * Every quote is one whole sentence copied from the page it links to, opened on Nov 2, 2026.
 * The apostrophes are written straight, as the rest of the site writes them.
 *
 *   Google Research   arXiv 2610.14224, first submitted Oct 9, 2026 (the repository
 *                     google-research/harness2 opened Oct 6, 2026); first sentence of the abstract.
 *   Y Combinator      Requests for Startups, Winter 2027, "Own Your Intelligence" by Jon Xu.
 *   NVIDIA Research   arXiv 2506.02153, submitted Jun 2, 2025; authors' affiliation NVIDIA Research
 *                     (and Georgia Tech); from section 3 of the paper.
 *   Anthropic         Engineering blog, Sep 29, 2025.
 *   OpenAI            Engineering post by Ryan Lopopolo, Feb 11, 2026.
 *   Stanford          arXiv 2510.04618 (ACE), first submitted Oct 6, 2025; authors from Stanford
 *                     University, SambaNova Systems and UC Berkeley; last sentence of the abstract.
 *   Meta              Meta Newsroom letter by Mark Zuckerberg, Jul 23, 2024.
 *
 * The marks are each organization's own, unaltered but for a one-colour wordmark drawn in
 * white, the reversed form for a dark ground:
 *   Google      the colour wordmark from gstatic.com's branding folder
 *   NVIDIA      the header logo symbol on nvidia.com (eye in its green, wordmark white)
 *   Anthropic   the header wordmark on anthropic.com
 *   OpenAI      the header wordmark on openai.com
 *   Meta        "Meta Platforms Inc. logo.svg" on Wikimedia Commons, drawn from Meta's brand
 *               resources page (symbol in its blues, wordmark white; a viewBox added to scale it)
 *   YC          the mark already in public/ (see Why)
 * Stanford is set as its name: it licenses its marks only to its own units.
 */

/**
 * A logo file in public/, and the size it is drawn at above its quote, chosen so every mark has a
 * like weight (a thin wide wordmark is shorter than a square one). The row of all of them draws
 * each at two thirds of this.
 */
export interface Mark {
  src: string;
  width: number;
  height: number;
}

export interface Validation {
  /** Who published it, as a reader would name them. */
  org: string;
  /** The organization's mark, or, where there is none to use, the name set large in its place. */
  mark?: Mark;
  name?: string;
  title: string;
  /** When it was published, as the source dates it. */
  date: string;
  href: string;
  /** One sentence, word for word. */
  quote: string;
}

export const VALIDATION: { title: string; slides: readonly Validation[] } = {
  title: 'Others working on this',
  slides: [
    {
      org: 'Google Research',
      mark: { src: './logos/google.svg', width: 136, height: 44 },
      title: 'Harness²: Recursive Agent Harnessing for an Open World',
      date: 'Oct 9, 2026',
      href: 'https://arxiv.org/abs/2610.14224',
      quote:
        "LLM agents' capabilities depend not only on their underlying models but also on their execution harnesses.",
    },
    {
      org: 'Y Combinator',
      mark: { src: './yc-mark.svg', width: 46, height: 46 },
      title: 'Own Your Intelligence',
      date: 'Winter 2027',
      href: 'https://www.ycombinator.com/rfs#own-your-intelligence',
      quote:
        'Open-weight models are now competitive with the top frontier models on meaningful benchmarks.',
    },
    {
      org: 'NVIDIA Research',
      mark: { src: './logos/nvidia.svg', width: 206, height: 38 },
      title: 'Small Language Models are the Future of Agentic AI',
      date: 'Jun 2, 2025',
      href: 'https://arxiv.org/abs/2506.02153',
      quote:
        'These systems typically decompose complex goals into modular sub-tasks, each of which can be reliably handled by specialized or fine-tuned SLMs.',
    },
    {
      org: 'Anthropic',
      mark: { src: './logos/anthropic.svg', width: 232, height: 26 },
      title: 'Effective context engineering for AI agents',
      date: 'Sep 29, 2025',
      href: 'https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents',
      quote:
        'These realities mean that thoughtful context engineering is essential for building capable agents.',
    },
    {
      org: 'OpenAI',
      mark: { src: './logos/openai.svg', width: 165, height: 44 },
      title: 'Harness engineering: leveraging Codex in an agent-first world',
      date: 'Feb 11, 2026',
      href: 'https://openai.com/index/harness-engineering/',
      quote:
        'Early progress was slower than we expected, not because Codex was incapable, but because the environment was underspecified.',
    },
    {
      org: 'Stanford, SambaNova and UC Berkeley',
      name: 'Stanford',
      title: 'Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models',
      date: 'Oct 6, 2025',
      href: 'https://arxiv.org/abs/2510.04618',
      quote:
        'These results show that comprehensive, evolving contexts enable scalable, efficient, and self-improving LLM systems with low overhead.',
    },
    {
      org: 'Meta',
      mark: { src: './logos/meta.svg', width: 199, height: 40 },
      title: 'Open Source AI is the Path Forward',
      date: 'Jul 23, 2024',
      href: 'https://about.fb.com/news/2024/07/open-source-ai-is-the-path-forward/',
      quote:
        "Many organizations handle sensitive data that they need to secure and can't send to closed models over cloud APIs.",
    },
  ],
};
