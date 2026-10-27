/** The parts of a scrolling element the pin reads and moves. */
export interface ScrollBox {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** How close to the bottom still counts as being at it, in pixels. */
export const PIN_SLACK_PX = 48;

export function distanceFromBottom(box: ScrollBox): number {
  return Math.max(0, box.scrollHeight - box.clientHeight - box.scrollTop);
}

/**
 * Keeps a chat on its newest content while the reader is at the bottom, and leaves the view
 * alone once they scroll up to read something earlier. Only a scroll upward lets go: content
 * that grows or a page that reflows never moves the view on its own.
 */
export class BottomPin {
  private pinned = true;
  private lastTop: number;

  constructor(
    private readonly box: ScrollBox,
    private readonly slack = PIN_SLACK_PX,
  ) {
    this.lastTop = box.scrollTop;
  }

  get isPinned(): boolean {
    return this.pinned;
  }

  /** Call on every scroll event. */
  scrolled(): void {
    const top = this.box.scrollTop;
    const movedUp = top < this.lastTop;
    this.lastTop = top;
    if (distanceFromBottom(this.box) <= this.slack) this.pinned = true;
    else if (movedUp) this.pinned = false;
  }

  /** Call when the content or the viewport changed size. Returns whether the view moved. */
  resized(): boolean {
    if (!this.pinned || distanceFromBottom(this.box) === 0) return false;
    this.scrollToEnd();
    return true;
  }

  /** Jumps to the newest content and follows it again, e.g. after the reader sends a message. */
  pinToBottom(): void {
    this.pinned = true;
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    this.box.scrollTop = this.box.scrollHeight;
    this.lastTop = this.box.scrollTop;
  }
}
