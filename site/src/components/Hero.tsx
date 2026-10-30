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
      <div className="page pt-10 sm:pt-12 lg:pt-12">
        <h1 id="hero-title" className="t-hero max-w-[13em]">
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
        <HeroWindow />
      </div>
    </section>
  );
}
