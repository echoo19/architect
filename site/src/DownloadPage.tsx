import type { ReactNode } from 'react';
import { APP_VERSION, MAC_DMG, MAC_INTEL_DMG, RELEASES, WINDOWS_INSTALLER } from './content';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { AppleMark, WindowsMark } from './components/OsMarks';

/**
 * The download page: one installer for each system, under its mark. The one for the computer the
 * page is open on is the solid button.
 */

function System({
  os,
  name,
  mark,
  href,
  children,
}: {
  os: 'mac' | 'windows';
  name: string;
  mark: ReactNode;
  href: string;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col items-center gap-5 rounded-card bg-card px-6 pb-6 pt-9 text-center shadow-edge">
      <span className="flex h-11 items-center">{mark}</span>
      <h2 className="t-h1">{name}</h2>
      <a className="btn btn-os w-full" data-for={os} href={href}>
        Download
      </a>
      <p className="t-small m-0 max-w-[30ch] text-pretty">{children}</p>
    </li>
  );
}

export function DownloadPage() {
  return (
    <div id="top" className="flex min-h-screen flex-col">
      <Header page="download" />
      <main id="main" className="page flex flex-1 flex-col items-center py-16 sm:py-24">
        <h1 className="t-title text-center">Download Architect</h1>
        <p className="t-read m-0 mt-4 max-w-[46ch] text-center text-pretty">
          One download includes both editions: Architect, which teaches an agent one job, and
          Architect Lab, a workbench for building models for a field. You choose one on the first
          run and can switch in Settings.
        </p>
        <ul className="m-0 mt-8 grid w-full max-w-[640px] list-none gap-4 p-0 sm:mt-12 sm:grid-cols-2">
          <System os="mac" name="macOS" mark={<AppleMark />} href={MAC_DMG}>
            For Macs with Apple silicon.{' '}
            <a className="link-quiet underline" href={MAC_INTEL_DMG}>
              Intel Mac version
            </a>
          </System>
          <System
            os="windows"
            name="Windows"
            mark={<WindowsMark size={36} />}
            href={WINDOWS_INSTALLER}
          >
            If Windows warns you the first time, choose More info, then Run anyway.
          </System>
        </ul>
        <a className="link-quiet t-small mt-8" href={RELEASES}>
          Version {APP_VERSION}
        </a>
      </main>
      <Footer page="download" />
    </div>
  );
}
