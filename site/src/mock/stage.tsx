import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { cn } from '@architect/ui';

/** The inline variables a stage reads: how tall it is in product pixels, wide and compact. */
type StageVars = CSSProperties & { '--h-wide'?: number; '--h-compact'?: number };

export interface StageProps {
  /** Names the stage for the captures and for the page's own scripts. */
  id: string;
  /** What the mock shows, in a sentence, for people who cannot see it. */
  label: string;
  /** Height in product pixels when the page has room for the wide layout, and when it does not. */
  heightWide: number;
  heightCompact: number;
  /** Plays the mock. A chapter's stage turns this on when it scrolls into view. */
  played: boolean;
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
export function Stage({
  id,
  label,
  heightWide,
  heightCompact,
  played,
  className,
  ref,
  children,
}: StageProps) {
  const style: StageVars = { '--h-wide': heightWide, '--h-compact': heightCompact };
  return (
    <div
      ref={ref}
      className={cn('stage', className)}
      data-stage={id}
      data-played={played ? '' : undefined}
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
 * True once the element has been in view, and true from then on: a chapter plays once and holds
 * its last frame. Before scripts run, and where there is no way to tell, it stays false and the
 * page's own styles show the finished picture.
 */
export function usePlayedOnce<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || played) return;
    if (typeof IntersectionObserver === 'undefined') {
      setPlayed(true);
      return;
    }
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPlayed(true);
          watcher.disconnect();
        }
      },
      { threshold },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [played, threshold]);
  return [ref, played] as const;
}

/** A stage that plays when it comes into view. */
export function ChapterStage(props: Omit<StageProps, 'played' | 'ref'>) {
  const [ref, played] = usePlayedOnce<HTMLDivElement>();
  return <Stage {...props} ref={ref} played={played} />;
}
