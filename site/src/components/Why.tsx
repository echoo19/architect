import { ArrowUpRight } from 'lucide-react';
import { WHY } from '../content';
import { Reveal } from './Reveal';

/** The two columns every row of the section shares, so titles and quotes keep to one edge each. */
const ROW = 'grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12';

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

/**
 * Why we made Architect: our reason beside the title, then each request that later asked for the
 * same thing, its title and author on the left and its words and our answer on the right.
 */
export function Why() {
  return (
    <section id="why" aria-labelledby="why-title" className="page scroll-mt-16 pb-24 lg:pb-32">
      <Reveal className={`${ROW} border-t border-line pt-12 lg:pt-16`}>
        <h2 id="why-title" className="t-title">
          {WHY.title}
        </h2>
        <div className="flex max-w-[40rem] flex-col gap-6">
          <p className="t-lead">{WHY.reason}</p>
          <p className="t-body m-0 text-pretty">{WHY.after}</p>
        </div>
      </Reveal>
      <ol className="m-0 mt-12 list-none p-0 lg:mt-16">
        {WHY.requests.map((request) => (
          <li key={request.href}>
            <Reveal className={`${ROW} border-t border-line py-8 lg:py-10`}>
              <div className="flex flex-col gap-1">
                <a
                  className="link-quiet t-h2 inline-flex items-center gap-2 self-start"
                  href={request.href}
                >
                  {request.title}
                  <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
                </a>
                <span className="t-body">{request.author}</span>
              </div>
              <div className="flex flex-col gap-4">
                <blockquote cite={request.href} className="m-0">
                  <p className="why-quote">
                    <Unbroken text={request.quote} />
                  </p>
                </blockquote>
                <p className="t-body m-0 max-w-[40rem] text-pretty">{request.answer}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}
