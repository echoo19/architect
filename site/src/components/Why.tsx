import { ArrowUpRight } from 'lucide-react';
import { WHY } from '../content';
import { Reveal } from './Reveal';

/** A quote whose hyphenated words ("high-quality") never break at the hyphen. */
function Unbroken({ text }: { text: string }) {
  return text.split(/(\S*\w-\w\S*)/).map((piece, index) =>
    index % 2 === 1 ? (
      <span key={index} className="whitespace-nowrap">
        {piece}
      </span>
    ) : (
      piece
    ),
  );
}

/** Y Combinator's mark: a white Y on its orange square. */
function YcMark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" fill="#F26625" />
      <path
        d="M9.5 8 16 18.5 22.5 8M16 18.5V25"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="square"
      />
    </svg>
  );
}

/**
 * Why we made Architect: the title and when the build began, our reason beside them, then the
 * requests that later asked for the same thing, under the list they came from, side by side:
 * each quote, then who asked and our answer, on one line across the three.
 */
export function Why() {
  return (
    <section id="why" aria-labelledby="why-title" className="page scroll-mt-16 pb-24 lg:pb-32">
      <Reveal className="grid gap-6 border-t border-line pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:pt-24">
        <div className="flex flex-col gap-3">
          <h2 id="why-title" className="t-title">
            {WHY.title}
          </h2>
          <p className="t-small m-0">{WHY.started}</p>
        </div>
        <p className="t-lead max-w-[36rem]">{WHY.reason}</p>
      </Reveal>
      <Reveal className="mt-16 lg:mt-24">
        <a
          className="link-quiet inline-flex items-center gap-3"
          href={WHY.source.href}
          aria-label={`${WHY.source.title}, ${WHY.source.season}`}
        >
          <YcMark />
          <span className="flex flex-col">
            <span className="t-body font-semibold">{WHY.source.title}</span>
            <span className="t-small">{WHY.source.season}</span>
          </span>
        </a>
      </Reveal>
      <ol className="m-0 mt-10 grid list-none gap-12 p-0 lg:mt-12 lg:grid-cols-3 lg:gap-12">
        {WHY.requests.map((request) => (
          <li key={request.href} className="grid lg:row-span-2 lg:grid-rows-subgrid">
            <Reveal className="grid gap-8 border-t border-line pt-8 lg:row-span-2 lg:grid-rows-subgrid">
              <blockquote cite={request.href} className="m-0">
                <p className="why-quote">
                  <Unbroken text={request.quote} />
                </p>
              </blockquote>
              <div className="flex flex-col gap-3">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2">
                  <a
                    className="link-quiet t-body inline-flex items-center gap-1 font-semibold"
                    href={request.href}
                  >
                    {request.title}
                    <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
                  </a>
                  <span className="t-small">{request.author}</span>
                </p>
                <p className="t-small m-0 text-pretty">{request.answer}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
