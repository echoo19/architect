import { LogoMark } from '@architect/ui';
import { FOOTER, RELEASES, REPO } from '../content';
import { GitHubMark } from './GitHubMark';
import { addresses, type Page } from './Header';

export function Footer({ page }: { page: Page }) {
  const to = addresses(page);
  return (
    <footer className="border-t border-line py-8">
      <div className="page mb-8">
        <p className="t-small m-0 max-w-[760px] text-pretty">
          {page === 'home' ? FOOTER.note : FOOTER.resultsNote}
        </p>
      </div>
      <div className="page flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-start gap-3">
          <LogoMark size={18} className="mt-[3px]" />
          <span>
            {FOOTER.licence} {FOOTER.author}
          </span>
        </p>
        <nav aria-label="Links" className="flex gap-6">
          <a className="link-quiet inline-flex items-center gap-2" href={REPO}>
            <GitHubMark size={18} />
            GitHub
          </a>
          <a className="link-quiet" href={to.results}>
            Results
          </a>
          <a className="link-quiet" href={RELEASES}>
            Releases
          </a>
        </nav>
      </div>
    </footer>
  );
}
