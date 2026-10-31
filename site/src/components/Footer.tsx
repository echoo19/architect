import { LogoMark } from '@architect/ui';
import { FOOTER, RELEASES, REPO } from '../content';
import { GitHubMark } from './GitHubMark';
import { addresses, type Page } from './Header';

export function Footer({ page }: { page: Page }) {
  const to = addresses(page);
  return (
    <footer className="border-t border-line pb-12 pt-10">
      {page !== 'download' && (
        <div className="page mb-10">
          <p className="t-small m-0 max-w-[72ch] text-pretty">
            {page === 'home' ? FOOTER.note : FOOTER.resultsNote}
          </p>
        </div>
      )}
      <div className="page flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="t-small m-0 flex items-center gap-3">
          <LogoMark size={18} className="shrink-0" />
          <span>
            {FOOTER.licence} {FOOTER.author}
          </span>
        </p>
        <nav aria-label="Links" className="-mx-3 flex gap-1">
          <a className="nav-link" href={REPO}>
            <GitHubMark size={16} />
            GitHub
          </a>
          <a className="nav-link" href={to.results}>
            Results
          </a>
          <a className="nav-link" href={RELEASES}>
            Releases
          </a>
        </nav>
      </div>
    </footer>
  );
}
