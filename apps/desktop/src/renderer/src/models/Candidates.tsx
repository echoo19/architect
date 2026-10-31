import { AgentAvatar, Button, Card, CardRow } from '@architect/ui';
import { Columns2 } from 'lucide-react';
import { shortDate } from '../flow/format';
import { formatPercent } from '../lib/format';
import { changesModel, versionModel } from './model-change';
import { comparable, imported, rowKey, scoresOf, type ModelRow } from './registry';

/**
 * Where a candidate came from, in a few words: a run here, an improvement of a version, the
 * field carried to another model from a version (decision 094), or another computer.
 */
export function originOf(row: ModelRow, rows: readonly ModelRow[]): string {
  const { version } = row;
  if (imported(version)) return 'Imported';
  if (version.parent !== undefined) {
    const parent = rows.find((other) => other.key === rowKey(row.agent.id, version.parent ?? 0));
    return parent && changesModel(version, parent.version)
      ? `On ${versionModel(version)}, from v${version.parent}`
      : `Improvement of v${version.parent}`;
  }
  return 'From training';
}

/**
 * The versions waiting to be accepted, each with where it came from and its final test, and one
 * click to set it beside the version that answers now. Nothing shows when none waits.
 */
export function Candidates({
  rows,
  onOpen,
  onCompare,
}: {
  rows: readonly ModelRow[];
  onOpen: (row: ModelRow) => void;
  onCompare: (candidate: ModelRow, active: ModelRow) => void;
}) {
  const waiting = rows
    .filter((row) => row.version.state === 'candidate' && !row.version.active)
    .sort((a, b) => (a.version.createdAt < b.version.createdAt ? 1 : -1));
  if (waiting.length === 0) return null;
  return (
    <Card title="Candidates" flush>
      {waiting.map((row) => {
        const active = rows.find(
          (other) => other.agent.id === row.agent.id && other.version.active,
        );
        const seen = scoresOf(row).seen;
        const name = `${row.agent.name} v${row.version.version}`;
        return (
          <CardRow
            key={row.key}
            icon={<AgentAvatar name={row.agent.name} />}
            title={name}
            detail={[
              originOf(row, rows),
              shortDate(row.version.createdAt),
              seen === null ? 'No final test' : `Final test ${formatPercent(seen)}`,
            ].join(' · ')}
            end={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Open ${name}`}
                  onClick={() => onOpen(row)}
                >
                  Open
                </Button>
                {active && comparable(row, active) && (
                  <Button
                    size="sm"
                    aria-label={`Compare ${name} with v${active.version.version}`}
                    onClick={() => onCompare(row, active)}
                  >
                    <Columns2 size={14} strokeWidth={1.8} aria-hidden />
                    Compare with v{active.version.version}
                  </Button>
                )}
              </>
            }
          />
        );
      })}
    </Card>
  );
}
