import { Fragment, type CSSProperties } from 'react';
import { HERO, README_SPECIALISTS, SPECIALISTS } from '../content';
import { Actors } from './Actors';
import { Downloads } from './Downloads';
import { addresses } from './Header';
import { HeroFilm } from './HeroFilm';

/** The place in the first screen's entrance a block takes, one beat after the one before. */
const beat = (index: number) => ({ '--i': index }) as CSSProperties;

type Specialist = { name: string; to: 'results' | 'readme'; anchor?: string };

/** "a, b and c" with each name a link. */
function Names({ list }: { list: readonly Specialist[] }) {
  const results = addresses('home').results;
  return (
    <>
      {list.map((item, index) => (
        <Fragment key={item.name}>
          {index > 0 && (index === list.length - 1 ? ' and ' : ', ')}
          {/^[AEIOU]/.test(item.name) ? 'an ' : 'a '}
          <a
            className="link-inline"
            href={item.to === 'results' ? `${results}#${item.anchor}` : README_SPECIALISTS}
          >
            {item.name}
          </a>
        </Fragment>
      ))}
    </>
  );
}

/** The claim, its two lines and the downloads, then the walkthrough film and what Architect makes. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pb-20 lg:pb-24">
      <div className="page pt-12 sm:pt-16 lg:pt-20">
        <h1 id="hero-title" className="t-hero enter max-w-[14em]" style={beat(0)}>
          {HERO.title}
        </h1>
        <p className="t-lead enter mt-6" style={beat(1)}>
          {HERO.line.map((sentence) => (
            <span key={sentence} className="lg:block">
              <Actors text={sentence} />{' '}
            </span>
          ))}
        </p>
        <Downloads className="enter mt-10" style={beat(2)} />
      </div>
      <div className="page enter mt-16 lg:mt-20" style={beat(3)}>
        <HeroFilm />
        <p className="t-body m-0 mt-8 text-pretty">
          It makes specialists such as <Names list={SPECIALISTS.made} />.{' '}
          <span className="inline-block">
            Next are <Names list={SPECIALISTS.next} />.
          </span>
        </p>
      </div>
    </section>
  );
}
