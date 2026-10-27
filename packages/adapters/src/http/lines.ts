/**
 * Splits a text stream into lines. A network chunk can end anywhere, so the unfinished tail is
 * kept for the next push, and a "\r\n" pair that straddles two chunks counts as one terminator.
 */
export class LineBuffer {
  private rest = '';
  private skipLineFeed = false;

  push(text: string): string[] {
    let input = text;
    if (this.skipLineFeed && input.length > 0) {
      if (input.startsWith('\n')) input = input.slice(1);
      this.skipLineFeed = false;
    }

    const buffer = this.rest + input;
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const char = buffer[i];
      if (char !== '\n' && char !== '\r') continue;
      lines.push(buffer.slice(start, i));
      if (char === '\r') {
        if (buffer[i + 1] === '\n') i += 1;
        else if (i === buffer.length - 1) this.skipLineFeed = true;
      }
      start = i + 1;
    }
    this.rest = buffer.slice(start);
    return lines;
  }

  /** The last line when the stream ends without a trailing newline. */
  flush(): string[] {
    const last = this.rest;
    this.rest = '';
    return last === '' ? [] : [last];
  }
}
