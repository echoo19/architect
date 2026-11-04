import { TriangleAlert } from 'lucide-react';

/**
 * The line every screen of a stand-in mentor's experiment carries, and can't be closed: a
 * scripted mentor's run shows the app working, never a finding.
 */
export function StandInNote() {
  return (
    <p
      role="note"
      className="m-0 flex items-center gap-3 rounded-card px-6 py-4 text-ui font-medium surface-card"
    >
      <TriangleAlert size={16} strokeWidth={1.8} aria-hidden className="shrink-0 text-mentor" />
      Stand-in mentor: a scripted mentor works this experiment, not a real model, so nothing it
      finds is a result.
    </p>
  );
}
