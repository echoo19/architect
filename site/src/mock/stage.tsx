import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@architect/ui';

/**
 * Where a stage is in its one run: not yet played, playing, or finished. A finished stage is its
 * finished picture and nothing moves in it, whether it played to the end, was scrolled past, or
 * sits in a window tall enough to show it with the rest of the page.
 */
export type Playback = 'waiting' | 'playing' | 'finished';

/** The inline variable a stage reads: how tall it is in product pixels where it is wide. */
type StageVars = CSSProperties & { '--h-wide'?: number };

export interface StageProps {
  /** Names the stage for the captures and for the page's own scripts. */
  id: string;
  /** What the mock shows, in a sentence, for people who cannot see it. */
  label: string;
  /**
   * Height in product pixels when the page has room for the wide layout. Where it does not, the
   * stage is as tall as its picture.
   */
  heightWide: number;
  /** Where the stage is in its run. A chapter's stage plays when it scrolls into view. */
  playback: Playback;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * The band a mock sits on, and the picture it frames. The mock is built at the product's own
 * sizes and zoomed as a whole (CSS zoom, so text is laid out at its real size and stays sharp),
 * and what does not fit is cropped by the band's edge instead of being shrunk to fit.
 * Its contents are a picture, so they are inert and named by `label`.
 */
export function Stage({ id, label, heightWide, playback, className, ref, children }: StageProps) {
  const style: StageVars = { '--h-wide': heightWide };
  return (
    <div
      ref={ref}
      className={cn('stage', className)}
      data-stage={id}
      data-played={playback === 'waiting' ? undefined : ''}
      data-finished={playback === 'finished' ? '' : undefined}
      role="img"
      aria-label={label}
      style={style}
    >
      <div className="stage-zoom" inert aria-hidden>
        {children}
      </div>
    </div>
  );
}

/**
 * A chapter plays once and holds its last frame. It starts when the element is a third in view,
 * and it is finished when its last animation ends, when it leaves the screen while playing, or
 * when it was scrolled past without being seen. A window at least twice the picture's height shows
 * it with the rest of the page, as a capture of the whole page does, so there is nothing to wait
 * for and it is finished at once. Before scripts run, and where there is no way to tell, the
 * page's own styles show the finished picture.
 */
export function useStagePlayback<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [playback, setPlayback] = useState<Playback>('waiting');
  const current = useRef<Playback>('waiting');
  const move = useCallback((next: Playback) => {
    current.current = next;
    setPlayback(next);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    // The film page plays a stage by seeking its animations, and sets the stage's state itself.
    if (document.documentElement.hasAttribute('data-film')) return;
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const state = current.current;
          if (state === 'finished') continue;
          if (state === 'waiting' && entry.intersectionRatio >= threshold) {
            move(window.innerHeight >= 2 * node.offsetHeight ? 'finished' : 'playing');
          } else if (!entry.isIntersecting) {
            const passed = entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
            if (state === 'playing' || passed) move('finished');
          }
        }
      },
      { threshold: [0, threshold] },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [threshold, move]);

  useEffect(() => {
    const node = ref.current;
    if (playback !== 'playing' || !node) return;
    let live = true;
    const ends = node
      .getAnimations({ subtree: true })
      .map((animation) => animation.finished.catch(() => undefined));
    void Promise.all(ends).then(() => {
      if (live) move('finished');
    });
    return () => {
      live = false;
    };
  }, [playback, move]);

  return [ref, playback] as const;
}

/** A stage that plays when it comes into view. */
export function ChapterStage(props: Omit<StageProps, 'playback' | 'ref'>) {
  const [ref, playback] = useStagePlayback<HTMLDivElement>();
  return <Stage {...props} ref={ref} playback={playback} />;
}
