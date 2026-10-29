import { cn, EvidenceMark, EvidenceMeter } from '@architect/ui';
import { RESULTS, type Results } from '../results';

/**
 * Measured results, under the report: the same final test, and how each way of doing it scored.
 * Until the numbers are filled in `src/results.ts`, it is a marked empty spot, so nothing on the
 * page states a result that was not measured.
 */
export function ResultsSlot({ results = RESULTS }: { results?: Results | null }) {
  if (results === null) {
    return (
      <div
        role="note"
        className="mt-6 flex flex-col gap-1 rounded-[10px] border border-dashed border-line-strong px-5 py-4 text-[15px] text-fg-secondary sm:mt-8"
      >
        <span className="font-bold text-fg">Results go here</span>
        <span>
          Add the measured final-test results in{' '}
          <code className="font-mono">site/src/results.ts</code>. The figures in the report above
          belong to a made-up sample job.
        </span>
      </div>
    );
  }
  return (
    <section
      aria-label={`Final test results on ${results.job}`}
      className="mt-6 rounded-[10px] border border-line px-5 py-5 sm:mt-8"
    >
      <p className="m-0 mb-4 flex items-center gap-2 text-[15px] text-fg-secondary">
        <EvidenceMark kind="final">Final test</EvidenceMark>
        <span>{results.job}</span>
      </p>
      <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {results.rows.map((row) => (
          <li key={row.label} className="flex flex-col gap-2">
            <span className={cn('text-[15px]', row.spark ? 'text-mentor' : 'text-fg')}>
              {row.label}
            </span>
            <span className="font-mono text-sm tabular-nums text-fg-secondary">
              <span className="text-fg">{row.passed}</span> of {row.total}
            </span>
            <EvidenceMeter
              kind="final"
              value={row.total === 0 ? 0 : row.passed / row.total}
              label={`${row.label}, final test`}
              valueText={`${row.passed} of ${row.total} passed`}
              {...(row.spark ? { marker: row.total === 0 ? 0 : row.passed / row.total } : {})}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
