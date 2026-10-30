import type { ReactNode } from 'react';
import type { ChapterCopy } from '../content';
import { Actors } from './Actors';
import { Reveal } from './Reveal';

/**
 * A chapter: a short claim, one line under it, and the mock that shows it. The claim and the line
 * share a row where the page is wide, with the line on the claim's baseline, and stack where it
 * is not.
 */
/** What a section needs to say: where it is, its claim, and the line under it. */
export type SectionCopy = Pick<ChapterCopy, 'title' | 'body'> & { id: string };

export function Chapter({ copy, children }: { copy: SectionCopy; children: ReactNode }) {
  return (
    <section
      id={copy.id}
      aria-labelledby={`${copy.id}-title`}
      className="scroll-mt-16 border-t border-line py-14 sm:py-16 lg:py-20"
    >
      <div className="page">
        <Reveal className="mb-8 grid gap-4 sm:mb-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:items-end lg:gap-x-16">
          <h2 id={`${copy.id}-title`} className="t-title max-w-[18ch]">
            {copy.title}
          </h2>
          <p className="t-lead max-w-[40ch] lg:pb-1">
            <Actors text={copy.body} />
          </p>
        </Reveal>
        {children}
      </div>
    </section>
  );
}
