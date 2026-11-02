import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { VALIDATION, type Validation } from '../validation';
import { Unbroken } from './Unbroken';

/** How long a slide stays before the next one, in ms. */
const HOLD = 6000;

/** The organization's mark, or its name set large where there is no mark to use. */
function Mark({ slide }: { slide: Validation }) {
  return (
    <div className="flex h-10 items-center">
      {slide.mark ? (
        <img
          src={slide.mark.src}
          width={slide.mark.width}
          height={slide.mark.height}
          alt={slide.org}
          className="block"
        />
      ) : (
        <span className="t-h1">{slide.name}</span>
      )}
    </div>
  );
}

/**
 * Published work from others pointing the same way as Architect, one at a time: a mark, one
 * sentence quoted word for word, and where it came from. The slides share one grid cell, so the
 * block is as tall as its tallest and nothing below it moves. Each turns over after a few seconds,
 * the old fading out before the new one rises in; pointing at it or moving focus into it holds it,
 * and it never turns by itself for visitors who asked for less motion.
 */
export function Others() {
  const { slides } = VALIDATION;
  const [index, setIndex] = useState(0);
  const [canRotate, setCanRotate] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [held, setHeld] = useState(false);
  const region = useRef<HTMLElement>(null);

  // Only a running page whose visitor has not asked for less motion turns by itself (html.motion).
  useEffect(() => {
    setCanRotate(document.documentElement.classList.contains('motion'));
  }, []);

  const rotating = canRotate && !stopped && !held;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => setIndex((at) => (at + 1) % slides.length), HOLD);
    return () => window.clearTimeout(timer);
  }, [rotating, index, slides.length]);

  const step = (by: number) => setIndex((at) => (at + by + slides.length) % slides.length);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else return;
    event.preventDefault();
  };

  const onBlur = (event: FocusEvent) => {
    if (!region.current?.contains(event.relatedTarget as Node | null)) setHeld(false);
  };

  return (
    <section
      ref={region}
      aria-roledescription="carousel"
      aria-labelledby="others-title"
      className="mt-24 border-t border-line pt-16 lg:mt-32 lg:pt-24"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <h3 id="others-title" className="t-h2">
        {VALIDATION.title}
      </h3>
      <div className="others mt-10 lg:mt-12" aria-live={rotating ? 'off' : 'polite'}>
        {slides.map((slide, at) => (
          <figure
            key={slide.href}
            className="others-slide m-0 flex flex-col gap-8"
            role="group"
            aria-roledescription="slide"
            aria-label={`${at + 1} of ${slides.length}`}
            data-active={at === index}
            aria-hidden={at !== index}
            inert={at !== index}
          >
            <Mark slide={slide} />
            <blockquote cite={slide.href} className="m-0">
              <p className="others-quote">
                <Unbroken text={slide.quote} />
              </p>
            </blockquote>
            <figcaption className="flex flex-col gap-1">
              <a className="link-quiet t-body font-semibold text-pretty" href={slide.href}>
                {slide.title}
                <ArrowUpRight
                  size={14}
                  strokeWidth={1.8}
                  aria-hidden
                  className="ml-1 inline-block align-baseline"
                />
              </a>
              <span className="t-small flex flex-wrap gap-x-3">
                <span>{slide.org}</span>
                <span>{slide.date}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-10 flex items-center justify-between gap-4">
        <div className="flex items-center">
          {slides.map((slide, at) => (
            <button
              key={slide.href}
              type="button"
              className="others-dot"
              aria-label={`${slide.org}, slide ${at + 1}`}
              aria-current={at === index}
              onClick={() => setIndex(at)}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {canRotate && (
            <button
              type="button"
              className="btn btn-sm others-control"
              aria-label={stopped ? 'Turn the slides' : 'Stop the slides'}
              onClick={() => setStopped((was) => !was)}
            >
              {stopped ? (
                <Play size={16} strokeWidth={1.8} aria-hidden />
              ) : (
                <Pause size={16} strokeWidth={1.8} aria-hidden />
              )}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm others-control"
            aria-label="Previous slide"
            onClick={() => step(-1)}
          >
            <ChevronLeft size={18} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn-sm others-control"
            aria-label="Next slide"
            onClick={() => step(1)}
          >
            <ChevronRight size={18} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
