import { ArrowUpRight } from 'lucide-react';
import { cn } from '@architect/ui';
import { REPORTS } from '../content';
import { RESULTS } from '../results';
import { Actors } from './Actors';
import { Reveal } from './Reveal';

/**
 * The measured results, under the report that is only a picture: the same final test taken three
 * ways, what else the run showed, and the link to the full reports. Everything it says is in
 * `src/results.ts`.
 */
export function MeasuredResults() {
  return (
    <section aria-labelledby="measured-title" className="mt-24 sm:mt-28">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-x-20">
        <Reveal className="flex flex-col items-start gap-5">
          <h3
            id="measured-title"
            className="m-0 font-display text-[28px] font-semibold leading-tight tracking-[-0.018em]"
          >
            {RESULTS.title}
          </h3>
          <p className="m-0 max-w-[46ch] text-pretty">
            <Actors text={RESULTS.scope} />
          </p>
          <a className="link-quiet inline-flex items-center gap-1.5" href={REPORTS}>
            {RESULTS.reports}
            <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
          </a>
        </Reveal>
        <Reveal delay={120}>
          <ul className="m-0 flex list-none flex-col gap-7 p-0">
            {RESULTS.rows.map((row) => (
              <li key={row.label} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span>
                    <Actors text={row.label} />
                  </span>
                  <span className="shrink-0 font-display text-[28px] font-semibold leading-none tracking-[-0.018em] tabular-nums">
                    {row.passed}
                    <span className="ml-1.5 text-[17px] font-normal tracking-normal">
                      {' '}
                      of {row.total}
                    </span>
                  </span>
                </div>
                <div
                  role="meter"
                  aria-label={row.label}
                  aria-valuemin={0}
                  aria-valuemax={row.total}
                  aria-valuenow={row.passed}
                  aria-valuetext={`${row.passed} of ${row.total} passed`}
                  className="relative h-1.5 rounded-full bg-line-strong"
                >
                  <span
                    className={cn(
                      'bar-grow absolute inset-y-0 left-0 rounded-full',
                      row.taught ? 'bg-student' : 'bg-fg',
                    )}
                    style={{ width: `${(row.passed / row.total) * 100}%` }}
                  />
                  <span
                    aria-hidden
                    className="absolute -top-1.5 h-[18px] w-0.5 rounded-mark bg-fg"
                    style={{ left: `calc(${RESULTS.target * 100}% - 1px)` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
      <ul className="m-0 mt-16 grid list-none grid-cols-1 gap-x-10 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {RESULTS.findings.map((finding) => (
          <li key={finding.figure} className="flex flex-col gap-3 border-t border-line pb-9 pt-5">
            <span className="font-display text-[28px] font-semibold leading-none tracking-[-0.018em] tabular-nums">
              {finding.figure}
            </span>
            <span className="max-w-[40ch] text-[16px] leading-snug text-pretty">
              <Actors text={finding.text} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
