import { cn } from '@architect/ui';
import { Download } from 'lucide-react';
import { RELEASES } from '../content';

/**
 * The two installers. Their file names carry the version, so both go to the latest release; the
 * button for the computer the page is open on, which the page works out before it paints, is the
 * solid one.
 */
export function Downloads({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row', className)}>
      <a className="btn btn-os" data-for="windows" href={RELEASES}>
        <Download size={17} strokeWidth={2} aria-hidden />
        Download for Windows
      </a>
      <a className="btn btn-os" data-for="mac" href={RELEASES}>
        <Download size={17} strokeWidth={2} aria-hidden />
        Download for macOS
      </a>
    </div>
  );
}
