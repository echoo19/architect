import { CLOSING, REPO } from '../content';
import { Downloads } from './Downloads';
import { GitHubMark } from './GitHubMark';
import { Reveal } from './Reveal';

/** The close: the name once more, the downloads, what a first run needs, and the code. */
export function Closing() {
  return (
    <section
      id="get"
      aria-labelledby="closing-title"
      className="scroll-mt-16 border-t border-line py-16 sm:py-20 lg:py-24"
    >
      <div className="page">
        <Reveal>
          <h2 id="closing-title" className="t-hero">
            {CLOSING.title}
          </h2>
          <Downloads className="mt-8 sm:mt-10" />
        </Reveal>
        <dl className="m-0 mt-12 max-w-[820px] sm:mt-14">
          {CLOSING.needs.map((need) => (
            <div
              key={need.name}
              className="grid gap-1 border-t border-line py-4 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-6"
            >
              <dt className="font-medium">{need.name}</dt>
              <dd className="m-0 text-pretty">{need.text}</dd>
            </div>
          ))}
        </dl>
        <a className="link-quiet mt-7 inline-flex items-center gap-2" href={REPO}>
          <GitHubMark size={18} />
          {CLOSING.github}
        </a>
      </div>
    </section>
  );
}
