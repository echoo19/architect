import type { ReactNode } from 'react';
import type { ChapterCopy } from '../content';
import { Actors } from './Actors';

/**
 * A chapter: a short claim, one line under it, and the mock that shows it. The claim and the line
 * share a row where the page is wide, with the line on the claim's baseline, and stack where it
 * is not.
 */
export function Chapter({ copy, children }: { copy: ChapterCopy; children: ReactNode }) {
  return (
    <section
      id={copy.id}
      aria-labelledby={`${copy.id}-title`}
      className="scroll-mt-16 border-t border-line py-20 sm:py-24 lg:py-32"
    >
      <div className="page">
        <div className="mb-10 grid gap-5 sm:mb-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:items-end lg:gap-x-16">
          <h2 id={`${copy.id}-title`} className="display-lg max-w-[20ch]">
            {copy.title}
          </h2>
          <p className="lead max-w-[40ch] lg:pb-1.5">
            <Actors text={copy.body} />
          </p>
        </div>
        {children}
      </div>
    </section>
  );
}
