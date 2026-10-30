import { useEffect, useState } from 'react';
import { cn } from '@architect/ui';
import { Download } from 'lucide-react';
import { WINDOWS_INSTALLER } from '../content';
import { addresses } from './Header';

/** The download page, which the home page's buttons go to when they can't go straight to a file. */
const DOWNLOAD_PAGE = addresses('home').download;

/**
 * Where "Download for Windows" goes: the installer itself for a visitor on Windows, which the
 * page works out before it paints, and the download page for anyone else and until the page has
 * run.
 */
function useWindowsAddress(): string {
  const [address, setAddress] = useState(DOWNLOAD_PAGE);
  useEffect(() => {
    if (document.documentElement.dataset.os === 'windows') setAddress(WINDOWS_INSTALLER);
  }, []);
  return address;
}

/**
 * The two downloads. The button for the computer the page is open on is the solid one; macOS goes
 * to the download page, where a Mac with Apple silicon and an Intel Mac each have their own.
 */
export function Downloads({ className }: { className?: string }) {
  const windows = useWindowsAddress();
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row', className)}>
      <a className="btn btn-os" data-for="windows" href={windows}>
        <Download size={17} strokeWidth={2} aria-hidden />
        Download for Windows
      </a>
      <a className="btn btn-os" data-for="mac" href={DOWNLOAD_PAGE}>
        <Download size={17} strokeWidth={2} aria-hidden />
        Download for macOS
      </a>
    </div>
  );
}
