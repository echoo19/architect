import type { CSSProperties } from 'react';
import { HERO } from '../content';
import { Actors } from './Actors';
import { Downloads } from './Downloads';
import { HeroFilm } from './HeroFilm';

/** The place in the first screen's entrance a block takes, one beat after the one before. */
const beat = (index: number) => ({ '--i': index }) as CSSProperties;

/** The claim, its two lines and the downloads, then the walkthrough film. */
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
      </div>
    </section>
  );
}
