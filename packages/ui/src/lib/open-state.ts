import { useCallback, useState } from 'react';

export interface OpenStateOptions {
  open?: boolean | undefined;
  defaultOpen?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}

/**
 * Whether an overlay is open, whether the caller holds the state or the overlay does. The
 * overlays animate out before they unmount, so their content has to know the state itself.
 */
export function useOpenState(
  options: OpenStateOptions,
): readonly [boolean, (open: boolean) => void] {
  const { open, defaultOpen = false, onOpenChange } = options;
  const [own, setOwn] = useState(defaultOpen);
  const controlled = open !== undefined;
  const set = useCallback(
    (next: boolean) => {
      if (!controlled) setOwn(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  return [controlled ? open : own, set];
}
