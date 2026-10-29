import type { Page } from '@playwright/test';

export interface PointerState {
  x: number;
  y: number;
  rippleAt?: number;
}

/** Draw immediately before each screenshot: hidden Electron windows do not animate on a timer. */
export async function drawPointer(page: Page, pointer: PointerState, nowMs: number): Promise<void> {
  await page.evaluate(
    ({ x, y, rippleAge }) => {
      let canvas = document.getElementById('architect-demo-pointer') as HTMLCanvasElement | null;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'architect-demo-pointer';
        Object.assign(canvas.style, {
          position: 'fixed',
          inset: '0',
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: '2147483647',
        });
        document.body.append(canvas);
      }
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cursor canvas unavailable');
      ctx.scale(ratio, ratio);
      if (rippleAge >= 0 && rippleAge < 420) {
        const progress = rippleAge / 420;
        ctx.beginPath();
        ctx.arc(x, y, 7 + progress * 22, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(240, 180, 112, ${0.48 * (1 - progress)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 20);
      ctx.lineTo(x + 5, y + 15);
      ctx.lineTo(x + 10, y + 24);
      ctx.lineTo(x + 14, y + 22);
      ctx.lineTo(x + 9, y + 13);
      ctx.lineTo(x + 17, y + 13);
      ctx.closePath();
      ctx.fillStyle = '#f8f8f8';
      ctx.strokeStyle = '#17191d';
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.fill();
      ctx.stroke();
    },
    { x: pointer.x, y: pointer.y, rippleAge: nowMs - (pointer.rippleAt ?? -10000) },
  );
}

export async function setSpeedMark(page: Page, factor?: number): Promise<void> {
  await page.evaluate((value) => {
    let mark = document.getElementById('architect-demo-speed');
    if (!value) {
      mark?.remove();
      return;
    }
    if (!mark) {
      mark = document.createElement('div');
      mark.id = 'architect-demo-speed';
      Object.assign(mark.style, {
        position: 'fixed',
        right: '24px',
        bottom: '22px',
        zIndex: '2147483646',
        padding: '6px 10px',
        border: '1px solid #41444c',
        borderRadius: '6px',
        color: '#f8f8f8',
        background: '#17191de8',
        font: '500 14px "Geist Variable", sans-serif',
        pointerEvents: 'none',
      });
      document.body.append(mark);
    }
    mark.textContent = `${value}×`;
  }, factor);
}

/** Draws the title card: `words` is how far its words have faded in, `card` the whole card. */
export async function showTitle(
  page: Page,
  title: { heading: string; eyebrow?: string },
  words: number,
  card: number,
): Promise<void> {
  await page.evaluate(
    ({ heading, eyebrow, words: wordsAlpha, card: alpha }) => {
      let card = document.getElementById('architect-demo-title');
      if (!card) {
        card = document.createElement('div');
        card.id = 'architect-demo-title';
        Object.assign(card.style, {
          position: 'fixed',
          inset: '0',
          zIndex: '2147483647',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 12%',
          background: '#101114',
          color: '#fafafa',
          fontFamily: '"Geist Variable", sans-serif',
          pointerEvents: 'none',
        });
        const line = document.createElement('div');
        Object.assign(line.style, {
          width: '48px',
          height: '3px',
          background: '#F0B470',
          marginBottom: '30px',
        });
        const eyebrowNode = document.createElement('div');
        eyebrowNode.id = 'architect-demo-eyebrow';
        Object.assign(eyebrowNode.style, {
          color: '#82B6F5',
          fontSize: '17px',
          letterSpacing: '0.08em',
          marginBottom: '14px',
        });
        const headingNode = document.createElement('div');
        headingNode.id = 'architect-demo-heading';
        Object.assign(headingNode.style, {
          fontSize: '58px',
          fontWeight: '600',
          letterSpacing: '-0.045em',
          lineHeight: '1.1',
          maxWidth: '900px',
        });
        card.append(line, eyebrowNode, headingNode);
        document.body.append(card);
      }
      card.style.opacity = String(alpha);
      for (const child of Array.from(card.children)) {
        (child as HTMLElement).style.opacity = String(wordsAlpha);
      }
      const eyebrowNode = document.getElementById('architect-demo-eyebrow');
      const headingNode = document.getElementById('architect-demo-heading');
      if (eyebrowNode) eyebrowNode.textContent = eyebrow ?? 'ARCHITECT';
      if (headingNode) headingNode.textContent = heading;
    },
    { ...title, words, card },
  );
}

export async function hideTitle(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('architect-demo-title')?.remove());
}
