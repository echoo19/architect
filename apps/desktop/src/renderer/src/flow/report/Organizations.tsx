import type { Score } from '@architect/shared';
import { cn } from '@architect/ui';
import { Section } from '../ledger';
import type { OrgGrid } from './org-grid';

/** The first column of each group after the first, which a hairline sets apart. */
function opensGroup(grid: OrgGrid, index: number): boolean {
  let start = 0;
  for (const group of grid.groups) {
    if (index === start) return start > 0;
    start += group.columns.length;
  }
  return false;
}

function Cell({ score, label, strong }: { score: Score | null; label: string; strong?: boolean }) {
  if (score === null) return <span aria-label={`${label}, not tested`} />;
  return (
    <span
      aria-label={`${label}, ${score.pass} of ${score.total} passed`}
      className={cn('font-mono tabular-nums', strong && 'font-medium')}
    >
      {score.pass}/{score.total}
    </span>
  );
}

/**
 * The final test, skill by skill, at each organization: those it trained with, those it never
 * saw, and a real one it never saw, each with its own result. A skill not tested at an
 * organization leaves its cell empty, which is not a zero.
 */
export function Organizations({ grid }: { grid: OrgGrid }) {
  const columns = grid.groups.flatMap((group) => group.columns);
  const edge = (index: number) => (opensGroup(grid, index) ? 'border-l border-line' : '');
  return (
    <Section title="By organization" id="organizations">
      <div className="overflow-x-auto border-b border-line">
        <table
          aria-label="Final test by organization"
          className="w-full min-w-[640px] border-collapse text-ui"
        >
          <thead>
            <tr>
              <th className="w-[26%]" />
              {grid.groups.map((group, index) => (
                <th
                  key={group.group}
                  scope="colgroup"
                  colSpan={group.columns.length}
                  className={cn(
                    'pb-2 pl-6 text-left text-small font-normal',
                    index > 0 && 'border-l border-line',
                  )}
                >
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              <th className="pb-3" />
              {columns.map((column, index) => (
                <th
                  key={column.org}
                  scope="col"
                  className={cn('pb-3 pl-6 text-left font-medium', edge(index))}
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.type} className="border-t border-line">
                <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                  {row.label}
                </th>
                {row.cells.map((cell, index) => {
                  const column = columns[index];
                  return (
                    <td key={column?.org ?? index} className={cn('py-3.5 pl-6', edge(index))}>
                      <Cell score={cell} label={`${row.label} at ${column?.name ?? ''}`} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <th scope="row" className="py-3.5 pr-4 text-left font-medium">
                All skills
              </th>
              {columns.map((column, index) => (
                <td key={column.org} className={cn('py-3.5 pl-6', edge(index))}>
                  <Cell score={column.score} label={`All skills at ${column.name}`} strong />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}
