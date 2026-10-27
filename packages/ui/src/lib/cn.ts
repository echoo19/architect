import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** tailwind-merge needs the theme's custom names, or it mistakes `text-chat` for a color. */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['chat', 'stat', 'display-sm', 'display', 'display-lg', 'hero', 'hero-lg'],
      shadow: ['composer', 'composer-sm', 'modal', 'popover', 'segment'],
      animate: ['rise', 'pop', 'pop-out', 'fade', 'fade-out', 'skeleton'],
      tracking: ['tightest'],
      ease: ['out-soft'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
