import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { BottomPin } from './scroll';

/**
 * Follows a chat's newest content while the reader is at the bottom. `viewport` is the
 * scrolling element and `content` the element inside it that grows.
 */
export function useBottomPin(
  viewport: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
) {
  const pin = useRef<BottomPin | null>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const box = viewport.current;
    const inner = content.current;
    if (!box || !inner) return;
    const current = new BottomPin(box);
    pin.current = current;
    current.pinToBottom();

    const onScroll = () => {
      current.scrolled();
      setPinned(current.isPinned);
    };
    const observer = new ResizeObserver(() => {
      current.resized();
      setPinned(current.isPinned);
    });
    box.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(box);
    observer.observe(inner);
    return () => {
      box.removeEventListener('scroll', onScroll);
      observer.disconnect();
      pin.current = null;
    };
  }, [viewport, content]);

  const pinToBottom = useCallback(() => {
    pin.current?.pinToBottom();
    setPinned(true);
  }, []);

  return { pinned, pinToBottom };
}
