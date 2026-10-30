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
      <div className="page pt-12 sm:pt-14 lg:pt-14">
        <h1 id="hero-title" className="display-xl max-w-[12.5em]">
          {HERO.title}
        </h1>
        <div className="mt-6 flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between xl:gap-12">
          <p className="lead max-w-[66ch]">
            {HERO.line.map((sentence) => (
              <span key={sentence} className="sm:block">
                <Actors text={sentence} />{' '}
              </span>
            ))}
          </p>
          <Downloads className="shrink-0" />
        </div>
      </div>
      <div className="page mt-10 sm:mt-12">
        <HeroWindow />
      </div>
    </section>
  );
}
