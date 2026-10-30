import { LogoMark } from '@architect/ui';
import { RELEASES, REPO } from '../content';

/** The wordmark, the code, and a way to download, in a bar that stays with the page. */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground">
      <div className="page flex h-16 items-center justify-between">
        <a
          href="#top"
          className="flex items-center gap-2.5 text-fg"
          aria-label="Architect, top of the page"
        >
          <LogoMark size={22} />
          <span className="text-[19px] font-bold tracking-[-0.02em]">Architect</span>
        </a>
        <nav aria-label="Main" className="flex items-center gap-5">
          <a className="link-quiet" href={REPO}>
            GitHub
          </a>
          <a className="btn btn-solid btn-sm" href={RELEASES}>
            Download
          </a>
        </nav>
      </div>
    </header>
  );
}
