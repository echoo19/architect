import { ArrowUpRight } from 'lucide-react';
import { CLOSING, REPO } from '../content';
import { Actors } from './Actors';
import { Downloads } from './Downloads';

/** The close: the name once more, the downloads, and the code. */
export function Closing() {
  return (
    <section
      id="get"
      aria-labelledby="closing-title"
      className="scroll-mt-16 border-t border-line py-24 sm:py-32 lg:py-44"
    >
      <div className="page">
        <h2 id="closing-title" className="display-xxl">
          {CLOSING.title}
        </h2>
        <Downloads className="mt-10 sm:mt-14" />
        <p className="mb-0 mt-7 max-w-[60ch] text-[16px] leading-relaxed text-fg text-pretty">
          <Actors text={CLOSING.needs} />
        </p>
        <a className="link-quiet mt-7 inline-flex items-center gap-1.5 text-[17px]" href={REPO}>
          {CLOSING.github}
          <ArrowUpRight size={17} strokeWidth={1.8} aria-hidden />
        </a>
      </div>
    </section>
  );
}
