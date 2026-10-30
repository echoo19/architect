import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** tailwind-merge needs the theme's custom names, or it mistakes `text-ui` for a color. */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['hero', 'title', 'h1', 'h2', 'body', 'ui', 'small', 'key'],
      shadow: ['edge', 'edge-strong', 'float'],
      radius: ['mark', 'control', 'card'],
      animate: ['rise', 'pop', 'fade', 'fade-out', 'skeleton'],
      ease: ['out-soft'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
