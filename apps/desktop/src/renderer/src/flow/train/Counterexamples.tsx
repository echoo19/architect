import {
  predicateSentence,
  type CaseTable,
  type Counterexample,
  type SuiteResult,
} from '@architect/shared';
import {
  Disclosure,
  DrawerSection,
  EvidenceMark,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@architect/ui';
import { ArrowRight, Check, CircleX } from 'lucide-react';
import { count, plural } from '../../fields/parts';

/** "2,311 rows → 4 rows": how far the failing call's inputs were cut down. */
export function reductionLine(counterexample: Counterexample) {
  const { originalRows, reducedRows } = counterexample.size;
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      {plural(originalRows, 'row')}
      <ArrowRight size={16} strokeWidth={2} aria-label="reduced to" />
      {plural(reducedRows, 'row')}
    </span>
  );
}

/** The call as it can be run again: the helper and its arguments. */
function callLine(counterexample: Counterexample): string {
  return `${counterexample.helper.name}(${JSON.stringify(counterexample.arguments)})`;
}

/** Rows a table shows at first; a wrong value's case can keep hundreds. */
const SHOWN_ROWS = 6;

function Rows({
  table,
  rows,
  label,
}: {
  table: CaseTable;
  rows: CaseTable['rows'];
  label: string;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table variant="plain" aria-label={label}>
        <TableHeader>
          <TableRow>
            {table.columns.map((column) => (
              <TableHead key={column} className="whitespace-nowrap">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {table.columns.map((column) => (
                <TableCell key={column} className="whitespace-nowrap first:font-normal">
                  {row[column] ?? '–'}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CaseTableView({ name, table }: { name: string; table: CaseTable }) {
  const rest = table.rows.slice(SHOWN_ROWS);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-small font-medium">{name}</span>
      {table.rows.length === 0 ? (
        <span className="text-small">No rows</span>
      ) : (
        <Rows table={table} rows={table.rows.slice(0, SHOWN_ROWS)} label={name} />
      )}
      {rest.length > 0 && (
        <Disclosure label={`${plural(rest.length, 'more row')}`}>
          <Rows table={table} rows={rest} label={`${name}, the rest`} />
        </Disclosure>
      )}
    </div>
  );
}

const CASE_WORDS: Record<SuiteResult['case'], string> = {
  reduced: 'Reduced case',
  original: 'Original attempt',
};

/** Whether a change to the helper passed the counterexample, and each case it ran. */
function RepairLine({ counterexample }: { counterexample: Counterexample }) {
  const { repair } = counterexample;
  if (!repair) {
    return <p className="m-0 text-body">No change to {counterexample.helper.name} tried yet.</p>;
  }
  const passed = repair.results.filter((result) => result.passed).length;
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 flex items-center gap-2 text-body">
        {repair.passed ? (
          <Check size={16} strokeWidth={2.2} aria-hidden className="shrink-0 text-student" />
        ) : (
          <CircleX size={16} strokeWidth={1.8} aria-hidden className="shrink-0 text-danger" />
        )}
        {repair.passed
          ? `Repaired in round ${repair.round}: passed ${plural(repair.results.length, 'case')}`
          : `Round ${repair.round}'s change failed ${count(repair.results.length - passed)} of ${plural(repair.results.length, 'case')}`}
      </p>
      <Disclosure label="Cases">
        <ul className="m-0 flex list-none flex-col p-0">
          {repair.results.map((result) => (
            <li
              key={result.case}
              className="flex items-start gap-2.5 border-t border-line py-2 text-small first:border-t-0"
            >
              {result.passed ? (
                <Check
                  size={14}
                  strokeWidth={2.2}
                  role="img"
                  aria-label="Passed"
                  className="mt-0.5 shrink-0 text-student"
                />
              ) : (
                <CircleX
                  size={14}
                  strokeWidth={1.8}
                  role="img"
                  aria-label="Failed"
                  className="mt-0.5 shrink-0 text-danger"
                />
              )}
              <span className="flex flex-col">
                <span className="font-medium">{CASE_WORDS[result.case]}</span>
                <span>{result.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

function CounterexampleView({ counterexample }: { counterexample: Counterexample }) {
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-display text-h2 font-semibold">{reductionLine(counterexample)}</span>
        <Tooltip
          content={
            counterexample.minimality === '1-minimal'
              ? 'Taking out any one of these rows loses the failure'
              : 'Cut down until the step limit; some rows may not be needed'
          }
        >
          <span tabIndex={0} className="rounded-mark text-small">
            {counterexample.minimality === '1-minimal' ? '1-minimal' : 'Reduced'}
          </span>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-body text-pretty">
          {predicateSentence(counterexample.helper.name, counterexample.predicate)}.
        </p>
        <span className="break-all font-mono text-small">{callLine(counterexample)}</span>
      </div>
      {Object.entries(counterexample.tables).map(([name, table]) => (
        <CaseTableView key={name} name={name} table={table} />
      ))}
      <RepairLine counterexample={counterexample} />
    </div>
  );
}

/**
 * A round's counterexamples (decision 078): a helper call that failed on a practice task, cut
 * down to the rows it still fails on, in plain words, and whether a change to the helper passed.
 */
export function RoundCounterexamples({
  counterexamples,
}: {
  counterexamples: readonly Counterexample[];
}) {
  if (counterexamples.length === 0) return null;
  return (
    <DrawerSection
      title={counterexamples.length === 1 ? 'Counterexample' : 'Counterexamples'}
      actions={<EvidenceMark kind="practice" />}
    >
      <div className="flex flex-col gap-4">
        {counterexamples.map((counterexample) => (
          <CounterexampleView key={counterexample.id} counterexample={counterexample} />
        ))}
      </div>
    </DrawerSection>
  );
}
