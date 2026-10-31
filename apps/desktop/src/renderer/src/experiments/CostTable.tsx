import type { ArmId, ComparisonReport } from '@architect/shared';
import { DataTable } from '@architect/ui';
import { Cloud, Laptop } from 'lucide-react';
import { formatCost } from '../flow/format';
import { formatScore } from '../lib/format';
import { costRowsOf, rowLabel, type CostRow } from './model';

const icon = { size: 14, strokeWidth: 1.7, 'aria-hidden': true } as const;

/** Where a model answered, with its mark. */
function RunsOn({ where }: { where: CostRow['runsOn'] }) {
  return (
    <span className="inline-flex items-center gap-2">
      {where === 'hosted' ? <Cloud {...icon} /> : <Laptop {...icon} />}
      {where === 'hosted' ? 'Hosted' : 'This computer'}
    </span>
  );
}

/**
 * Each arm's accuracy on the final test against what 1,000 requests like it cost where it
 * answered (decision 096), so the student taught here and the teacher alone read side by side.
 */
export function CostTable({
  report,
  arms,
}: {
  report: ComparisonReport;
  /** The arms by name, as the experiment's other figures and tables call them. */
  arms: Record<ArmId, string>;
}) {
  const rows = costRowsOf(report);
  if (rows.length === 0) return null;
  return (
    <DataTable
      aria-label="Accuracy against cost"
      rows={rows}
      rowKey={(item) => item.key}
      columns={[
        { key: 'arm', header: 'Arm', cell: (item) => rowLabel(item.row, arms) },
        { key: 'model', header: 'Model', cell: (item) => item.model },
        {
          key: 'where',
          header: 'Runs on',
          width: '168px',
          cell: (item) => <RunsOn where={item.runsOn} />,
        },
        {
          key: 'accuracy',
          header: 'Final test',
          align: 'end',
          width: '168px',
          cell: (item) => formatScore(item.row.scenarios),
        },
        {
          key: 'cost',
          header: 'Per 1,000 requests',
          align: 'end',
          width: '168px',
          cell: (item) => (item.perThousandUsd === null ? null : formatCost(item.perThousandUsd)),
        },
      ]}
    />
  );
}
