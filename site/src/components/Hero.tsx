import { HERO } from '../content';
import { Actors } from './Actors';
import { Downloads } from './Downloads';
import { HeroFilm } from './HeroFilm';

/** One claim, one line and the downloads, then the walkthrough film. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pb-14 sm:pb-16 lg:pb-20">
      <div className="page pt-10 sm:pt-12 lg:pt-12">
        <h1 id="hero-title" className="t-hero max-w-[15em]">
          {HERO.title}
        </h1>
        <div className="mt-5 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between xl:gap-12">
          <p className="t-lead max-w-[66ch]">
            {HERO.line.map((sentence) => (
              <span key={sentence} className="sm:block">
                <Actors text={sentence} />{' '}
              </span>
            ))}
          </p>
          <Downloads className="shrink-0" />
        </div>
      </div>
      <div className="page mt-9 sm:mt-10">
        <HeroFilm />
      </div>
    </section>
  );
}
