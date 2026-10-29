import { HERO } from '../content';
import { HeroWindow } from '../mock/hero-window';
import { Actors } from './Actors';
import { Downloads } from './Downloads';

/**
 * One claim, one line and the downloads, then the window. The section has no padding under it:
 * the window is its last thing, cropped by the band's edge, not shrunk to fit inside it.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden">
      <div className="page pt-12 sm:pt-14 lg:pt-16">
        <p className="eyebrow">{HERO.eyebrow}</p>
        <h1 id="hero-title" className="display-xl mt-5 max-w-[13.5em] sm:mt-6">
          {HERO.title}
        </h1>
        <p className="lead mt-6 max-w-[66ch]">
          {HERO.line.map((sentence) => (
            <span key={sentence} className="sm:block">
              <Actors text={sentence} />{' '}
            </span>
          ))}
        </p>
        <Downloads className="mt-8" />
      </div>
      <div className="page mt-12 sm:mt-14">
        <HeroWindow />
      </div>
    </section>
  );
}
