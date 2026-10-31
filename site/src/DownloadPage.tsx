import type { CSSProperties, ReactNode } from 'react';
import { APP_VERSION, MAC_DMG, MAC_INTEL_DMG, RELEASES, WINDOWS_INSTALLER } from './content';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { AppleMark, WindowsMark } from './components/OsMarks';

/**
 * The download page: what the one download holds, in a line, then a button for each system with
 * its one note under it. The button for the computer the page is open on is the solid one.
 */

const beat = (index: number) => ({ '--i': index }) as CSSProperties;

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
    <li className="flex flex-col gap-3">
      <a className="btn btn-os w-full" data-for={os} href={href}>
        {mark}
        Download for {name}
      </a>
      <p className="t-small m-0 text-center text-pretty">{children}</p>
    </li>
  );
}

export function DownloadPage() {
  return (
    <div id="top" className="flex min-h-screen flex-col">
      <Header page="download" />
      <main
        id="main"
        className="page flex flex-1 flex-col items-center justify-center py-20 sm:py-28"
      >
        <h1 className="t-title enter text-center" style={beat(0)}>
          Download Architect
        </h1>
        <p className="t-lead enter m-0 mt-4 max-w-[36ch] text-center sm:max-w-none" style={beat(1)}>
          One download, two editions: Architect for one job, Architect Lab for a whole field.
        </p>
        <ul
          className="enter m-0 mt-12 grid w-full max-w-[560px] list-none gap-6 p-0 sm:grid-cols-2 sm:gap-3"
          style={beat(2)}
        >
          <System os="mac" name="macOS" mark={<AppleMark size={18} />} href={MAC_DMG}>
            For Apple silicon.{' '}
            <a className="link-inline" href={MAC_INTEL_DMG}>
              Intel Mac
            </a>
          </System>
          <System
            os="windows"
            name="Windows"
            mark={<WindowsMark size={16} />}
            href={WINDOWS_INSTALLER}
          >
            If Windows warns you, choose More info, then Run anyway.
          </System>
        </ul>
        <a className="link-quiet t-small enter mt-12 tabular-nums" style={beat(3)} href={RELEASES}>
          Version {APP_VERSION}
        </a>
      </main>
      <Footer page="download" />
    </div>
  );
}
