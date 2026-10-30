import { ArrowUpRight } from 'lucide-react';
import { CLOSING, REPO } from '../content';
import { Downloads } from './Downloads';
import { Reveal } from './Reveal';

/** The close: the name once more, the downloads, what a first run needs, and the code. */
export function Closing() {
  return (
    <section
      id="get"
      aria-labelledby="closing-title"
      className="scroll-mt-16 border-t border-line py-24 sm:py-32 lg:py-40"
    >
      <div className="page">
        <Reveal>
          <h2 id="closing-title" className="display-xxl">
            {CLOSING.title}
          </h2>
          <Downloads className="mt-10 sm:mt-14" />
        </Reveal>
        <dl className="m-0 mt-16 max-w-[820px] sm:mt-20">
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
        <a className="link-quiet mt-8 inline-flex items-center gap-1.5 text-[17px]" href={REPO}>
          {CLOSING.github}
          <ArrowUpRight size={17} strokeWidth={1.8} aria-hidden />
        </a>
      </div>
    </section>
  );
}
