import { useEffect, useState, type ReactNode } from 'react';
import { Collapse } from '@architect/ui';
import { ROOMY } from './ledger';

/**
 * A row added to a list that is already on screen opens into place, so what lies below it moves
 * smoothly instead of jumping. A row that was there from the start is simply there.
 */
export function Appear({ added, children }: { added: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!added);
  useEffect(() => setOpen(true), []);
  return (
    <Collapse open={open} className={ROOMY}>
      {children}
    </Collapse>
  );
}

/** The keys a list was first drawn with; a row whose key is not among them was added later. */
export function useFirstKeys(keys: readonly string[]): ReadonlySet<string> {
  const [first] = useState(() => new Set(keys));
  return first;
}
