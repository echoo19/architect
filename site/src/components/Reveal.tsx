import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * A block of the page that rises into place when it first comes into view. Nothing is hidden until
 * the page is running: the block starts as plain content, and only one that is still below the
 * window is set aside, then brought in as it nears the window's edge. One already in view, or
 * above it, stays as it is.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** How long after it enters the window it starts, in ms. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    if (!document.documentElement.classList.contains('motion')) return;
    if (node.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    node.dataset.armed = '';
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        node.dataset.seen = '';
        watcher.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  const style: CSSProperties & Record<'--reveal-delay', string> = {
    '--reveal-delay': `${delay}ms`,
  };
  return (
    <div ref={ref} data-reveal="" className={className} style={style}>
      {children}
    </div>
  );
}
