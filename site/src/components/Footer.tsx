import { LogoMark } from '@architect/ui';
import { FOOTER, RELEASES, REPO } from '../content';

export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <p className="page m-0 mb-6 max-w-[760px] text-[13px] text-fg-muted text-pretty">
        {FOOTER.note}
      </p>
      <div className="page flex flex-col gap-6 text-[15px] text-fg-secondary sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 flex items-center gap-3">
          <LogoMark size={18} className="text-fg" />
          <span>
            {FOOTER.licence} {FOOTER.author}
          </span>
        </p>
        <nav aria-label="Links" className="flex gap-6">
          <a className="link-quiet" href={REPO}>
            GitHub
          </a>
          <a className="link-quiet" href={RELEASES}>
            Releases
          </a>
        </nav>
      </div>
    </footer>
  );
}
