import type { CSSProperties, ReactNode } from 'react';
import { APP_VERSION, MAC_DMG, MAC_INTEL_DMG, RELEASES, WINDOWS_INSTALLER } from './content';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { AppleMark, WindowsMark } from './components/OsMarks';

/**
 * The download page: what the one download holds, in a line, then a button for each system in the
 * home page's order, and one row under them with the version, the Intel Mac's download and what to
 * do if Windows warns. The button for the computer the page is open on is the solid one.
 */

const beat = (index: number) => ({ '--i': index }) as CSSProperties;

function System({
  os,
  name,
  mark,
  href,
}: {
  os: 'mac' | 'windows';
  name: string;
  mark: ReactNode;
  href: string;
}) {
  return (
    <li>
      <a className="btn btn-os w-full" data-for={os} href={href}>
        {mark}
        Download for {name}
      </a>
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
          className="enter m-0 mt-12 grid w-full max-w-[560px] list-none gap-3 p-0 sm:grid-cols-2"
          style={beat(2)}
        >
          <System
            os="windows"
            name="Windows"
            mark={<WindowsMark size={16} />}
            href={WINDOWS_INSTALLER}
          />
          <System os="mac" name="macOS" mark={<AppleMark size={18} />} href={MAC_DMG} />
        </ul>
        <p className="t-small enter m-0 mt-8 text-center text-pretty tabular-nums" style={beat(3)}>
          <a className="link-quiet" href={RELEASES}>
            Version {APP_VERSION}
          </a>
          <span aria-hidden> · </span>
          <a className="link-inline" href={MAC_INTEL_DMG}>
            Intel Mac
          </a>
          <span aria-hidden> · </span>
          <span className="inline-block">If Windows warns you: More info, then Run anyway</span>
        </p>
      </main>
      <Footer page="download" />
    </div>
  );
}
