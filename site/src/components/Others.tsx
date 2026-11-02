import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { VALIDATION, type Validation } from '../validation';
import { Unbroken } from './Unbroken';

/** How long a slide stays before the next one, in ms. */
const HOLD = 6000;

/** The organization's mark at its own height (the CSS scales it per place), or its name. */
function Mark({ slide, alt }: { slide: Validation; alt: string }) {
  if (!slide.mark) return <span className="others-name">{slide.name}</span>;
  const style: CSSProperties & Record<'--mark-h', number> = { '--mark-h': slide.mark.height };
  return (
    <img
      src={slide.mark.src}
      width={slide.mark.width}
      height={slide.mark.height}
      alt={alt}
      className="others-mark"
      style={style}
    />
  );
}

/**
 * Published work from others pointing the same way as Architect, one at a time: its mark large,
 * one sentence quoted word for word, and where it came from. Under it, every organization's mark
 * in a row, the current one at full strength; each shows its own. The slides share one grid
 * cell, so the block is as tall as its tallest and nothing below it moves. Each turns over after
 * a few seconds, the old fading out before the new one rises in; pointing at it or moving focus
 * into it holds it, and it never turns by itself for visitors who asked for less motion.
 */
export function Others() {
  const { slides } = VALIDATION;
  const [index, setIndex] = useState(0);
  const [canRotate, setCanRotate] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [held, setHeld] = useState(false);
  const region = useRef<HTMLElement>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);

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

  // Arrow keys turn the slides; on the row of marks, focus follows to the one now shown.
  const onKeyDown = (event: KeyboardEvent) => {
    const by = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (by === 0) return;
    event.preventDefault();
    const next = (index + by + slides.length) % slides.length;
    setIndex(next);
    if (chips.current.includes(event.target as HTMLButtonElement)) chips.current[next]?.focus();
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
      <div className="others mt-10 lg:mt-16" aria-live={rotating ? 'off' : 'polite'}>
        {slides.map((slide, at) => (
          <figure
            key={slide.href}
            className="others-slide m-0 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
            role="group"
            aria-roledescription="slide"
            aria-label={`${at + 1} of ${slides.length}`}
            data-active={at === index}
            aria-hidden={at !== index}
            inert={at !== index}
          >
            <div className="others-lead">
              <Mark slide={slide} alt={slide.org} />
            </div>
            <div className="flex flex-col gap-8">
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
            </div>
          </figure>
        ))}
      </div>
      <div className="mt-12 flex flex-col gap-6 border-t border-line pt-8 lg:mt-16 lg:flex-row lg:items-center lg:gap-12">
        <div className="others-row">
          {slides.map((slide, at) => (
            <button
              key={slide.href}
              ref={(node) => {
                chips.current[at] = node;
              }}
              type="button"
              className="others-chip"
              aria-label={slide.org}
              aria-current={at === index}
              onClick={() => setIndex(at)}
            >
              <Mark slide={slide} alt="" />
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2">
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
