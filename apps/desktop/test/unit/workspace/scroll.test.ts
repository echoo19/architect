import { describe, expect, it } from 'vitest';
import {
  BottomPin,
  distanceFromBottom,
  PIN_SLACK_PX,
  type ScrollBox,
} from '../../../src/renderer/src/workspace/scroll';

/** A scrolling element that clamps like a browser does, also when its content shrinks. */
class FakeBox implements ScrollBox {
  private top = 0;
  constructor(
    public scrollHeight: number,
    public clientHeight = 400,
  ) {}
  private clamp(value: number): number {
    return Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
  }
  get scrollTop(): number {
    return this.clamp(this.top);
  }
  set scrollTop(value: number) {
    this.top = this.clamp(value);
  }
}

function setup(height = 1000) {
  const box = new FakeBox(height);
  const pin = new BottomPin(box);
  pin.pinToBottom();
  /** The reader scrolls to a position; the browser then fires a scroll event. */
  const scrollTo = (top: number) => {
    box.scrollTop = top;
    pin.scrolled();
  };
  /** Content grows or shrinks; the browser keeps scrollTop, then a ResizeObserver fires. */
  const grow = (by: number) => {
    box.scrollHeight += by;
    return pin.resized();
  };
  return { box, pin, scrollTo, grow };
}

describe('BottomPin', () => {
  it('starts at the bottom and follows new content there', () => {
    const { box, pin, grow } = setup();
    expect(distanceFromBottom(box)).toBe(0);
    expect(grow(240)).toBe(true);
    expect(distanceFromBottom(box)).toBe(0);
    expect(pin.isPinned).toBe(true);
  });

  it('leaves the view where the reader put it once they scroll up', () => {
    const { box, pin, scrollTo, grow } = setup();
    scrollTo(200);
    expect(pin.isPinned).toBe(false);
    expect(grow(300)).toBe(false);
    expect(box.scrollTop).toBe(200);
  });

  it('counts a reader within the slack of the bottom as at the bottom', () => {
    const { box, pin, scrollTo, grow } = setup();
    scrollTo(600 - (PIN_SLACK_PX - 8));
    expect(pin.isPinned).toBe(true);
    grow(120);
    expect(distanceFromBottom(box)).toBe(0);
  });

  it('follows again when the reader comes back down', () => {
    const { box, pin, scrollTo, grow } = setup();
    scrollTo(100);
    grow(200);
    expect(pin.isPinned).toBe(false);
    scrollTo(box.scrollHeight);
    expect(pin.isPinned).toBe(true);
    grow(50);
    expect(distanceFromBottom(box)).toBe(0);
  });

  it('keeps following when content grows before a downward scroll lands', () => {
    const { box, pin, grow, scrollTo } = setup();
    box.scrollHeight += 500;
    scrollTo(box.scrollTop + 10);
    expect(pin.isPinned).toBe(true);
    grow(0);
    expect(distanceFromBottom(box)).toBe(0);
  });

  it('stays at the bottom when content above shrinks', () => {
    const { box, pin, grow } = setup();
    grow(-300);
    pin.scrolled();
    expect(pin.isPinned).toBe(true);
    expect(distanceFromBottom(box)).toBe(0);
  });

  it('jumps back to the newest content on request', () => {
    const { box, pin, scrollTo } = setup(2000);
    scrollTo(0);
    expect(pin.isPinned).toBe(false);
    pin.pinToBottom();
    expect(pin.isPinned).toBe(true);
    expect(distanceFromBottom(box)).toBe(0);
  });
});
