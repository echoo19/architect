import { LogoMark } from '@architect/ui';
import { RELEASES, REPO } from '../content';
import { GitHubMark } from './GitHubMark';

/** Which of the site's two pages a bar or a footer is on, for the links that go between them. */
export type Page = 'home' | 'results';

/** Where each page is from the other, as an address that works from any folder the site is served in. */
export function addresses(page: Page) {
  return {
    home: page === 'home' ? '#top' : '../',
    results: page === 'home' ? './results/' : './',
    get: page === 'home' ? '#get' : '../#get',
  };
}

/** The wordmark, the code, the results, and a way to download, in a bar that stays with the page. */
export function Header({ page }: { page: Page }) {
  const to = addresses(page);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground">
      <div className="page flex h-14 items-center justify-between">
        <a
          href={to.home}
          className="flex items-center gap-2.5 text-fg"
          aria-label="Architect, top of the page"
        >
          <LogoMark size={22} />
          <span className="font-display text-h2 font-semibold">Architect</span>
        </a>
        <nav aria-label="Main" className="flex items-center gap-5 sm:gap-6">
          <a className="link-quiet inline-flex items-center gap-2" href={REPO}>
            <GitHubMark size={20} />
            <span className="max-sm:sr-only">GitHub</span>
          </a>
          <a
            className="link-quiet"
            href={to.results}
            {...(page === 'results' ? { 'aria-current': 'page' as const } : {})}
          >
            Results
          </a>
          <a className="btn btn-solid btn-sm" href={RELEASES}>
            Download
          </a>
        </nav>
      </div>
    </header>
  );
}
