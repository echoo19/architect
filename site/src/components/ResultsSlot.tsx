import { EvidenceMark, EvidenceMeter } from '@architect/ui';
import { ArrowUpRight } from 'lucide-react';
import { REPORTS } from '../content';
import { RESULTS } from '../results';
import { Actors } from './Actors';

/**
 * The measured results, under the report that is only a picture: the same final test taken three
 * ways, what else the run showed, and the link to the full reports. Everything it says is in
 * `src/results.ts`.
 */
export function ResultsSlot() {
  return (
    <section
      aria-labelledby="measured-title"
      className="mt-6 rounded-[10px] px-5 py-7 sm:mt-8 sm:px-8 sm:py-9 shadow-edge"
    >
      <h3
        id="measured-title"
        className="m-0 text-[24px] font-bold leading-tight tracking-[-0.015em] text-fg"
      >
        {RESULTS.title}
      </h3>
      <p className="mb-0 mt-3 max-w-[62ch] text-[17px] leading-relaxed text-fg text-pretty">
        <Actors text={RESULTS.scope} />
      </p>
      <div className="mt-8 grid gap-x-14 gap-y-9 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-5">
          <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-fg">
            <EvidenceMark kind="final" className="text-[15px]">
              Final test
            </EvidenceMark>
            <span>{RESULTS.test}</span>
          </p>
          <ul className="m-0 flex list-none flex-col gap-6 p-0">
            {RESULTS.rows.map((row) => (
              <li key={row.label} className="flex flex-col gap-2">
                <span className="text-[16px] text-fg">
                  <Actors text={row.label} />
                </span>
                <span className="font-mono text-[15px] tabular-nums text-fg">
                  <span className="text-fg">{row.passed}</span> of {row.total}
                </span>
                <EvidenceMeter
                  kind="final"
                  value={row.total === 0 ? 0 : row.passed / row.total}
                  label={`${row.label}, final test`}
                  valueText={`${row.passed} of ${row.total} passed`}
                />
                {row.note && <span className="text-[15px] text-fg">{row.note}</span>}
              </li>
            ))}
          </ul>
        </div>
        <ul className="m-0 flex list-none flex-col p-0">
          {RESULTS.findings.map((finding) => (
            <li
              key={finding}
              className="border-t border-line py-4 text-[16px] leading-snug text-fg first:border-t-0 first:pt-0"
            >
              <Actors text={finding} />
            </li>
          ))}
        </ul>
      </div>
      <p className="mb-0 mt-8 max-w-[62ch] text-[16px] leading-snug text-fg text-pretty">
        {RESULTS.earlier}
      </p>
      <a className="link-quiet mt-4 inline-flex items-center gap-1.5 text-[16px]" href={REPORTS}>
        {RESULTS.reports}
        <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden />
      </a>
    </section>
  );
}
