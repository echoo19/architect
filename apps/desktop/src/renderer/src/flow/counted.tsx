import type { ReactNode } from 'react';

/**
 * Numbers that roll to their new values, with what they say written out once. The rolling digits
 * are for the eye, and each column holds every digit, so what reads the page as text, screen
 * readers included, takes the written line instead.
 */
export function Counted({
  said,
  className,
  children,
}: {
  /** The numbers as one would say them: "31 of 40". */
  said: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <span aria-hidden className={className}>
        {children}
      </span>
      <span className="sr-only">{said}</span>
    </>
  );
}
