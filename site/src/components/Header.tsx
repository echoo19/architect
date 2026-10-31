import { useEffect, useRef } from 'react';
import { LogoMark } from '@architect/ui';
import { REPO } from '../content';
import { GitHubMark } from './GitHubMark';

/** Which of the site's pages a bar or a footer is on, for the links that go between them. */
export type Page = 'home' | 'results' | 'download';

/** Where each page is from the other, as an address that works from any folder the site is served in. */
export function addresses(page: Page) {
  const folder = (name: Page) =>
    page === name ? './' : page === 'home' ? `./${name}/` : `../${name}/`;
  return {
    home: page === 'home' ? '#top' : '../',
    results: folder('results'),
    download: folder('download'),
  };
}

/** Marks the bar once the page has scrolled under it, so its hairline shows only then. */
function useScrolled() {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = bar.current;
    if (!node) return;
    const update = () => {
      if (window.scrollY > 4) node.dataset.scrolled = '';
      else delete node.dataset.scrolled;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return bar;
}

/** The wordmark, the code, the results, and a way to download, in a bar that stays with the page. */
export function Header({ page }: { page: Page }) {
  const to = addresses(page);
  const bar = useScrolled();
  return (
    <header ref={bar} className="site-bar sticky top-0 z-40 bg-ground">
      <div className="page flex h-16 items-center justify-between">
        <a
          href={to.home}
          className="-ml-2 flex h-9 items-center gap-3 rounded-control px-2 text-fg"
          aria-label="Architect, top of the page"
        >
          <LogoMark size={22} />
          <span className="t-h2">Architect</span>
        </a>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <a className="nav-link max-sm:px-2" href={REPO}>
            <GitHubMark size={18} />
            <span className="max-sm:sr-only">GitHub</span>
          </a>
          <a
            className="nav-link"
            href={to.results}
            {...(page === 'results' ? { 'aria-current': 'page' as const } : {})}
          >
            Results
          </a>
          <a
            className="btn btn-solid btn-sm ml-2"
            href={to.download}
            {...(page === 'download' ? { 'aria-current': 'page' as const } : {})}
          >
            Download
          </a>
        </nav>
      </div>
    </header>
  );
}
