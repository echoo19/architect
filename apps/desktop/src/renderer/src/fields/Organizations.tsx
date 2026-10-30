import { useState } from 'react';
import type { FieldView } from '@architect/shared';
import { Card, CardRow } from '@architect/ui';
import { Building2, Lock } from 'lucide-react';
import { formatBytes } from '../lib/format';
import { plural, Quiet, Tile } from './parts';

type TaughtOn = FieldView['organizations'][number];

const kindWord = (synthetic: boolean | null) =>
  synthetic === null ? null : synthetic ? 'Generated' : 'Real';

/** "Generated · 12 files · 4,210 rows": what an organization the job trains on holds. */
function holds(org: TaughtOn): string {
  const rows = org.files.reduce((sum, file) => sum + (file.rows ?? 0), 0);
  const tables = org.files.some((file) => file.rows !== null);
  return [kindWord(org.synthetic), plural(org.files.length, 'file'), tables && plural(rows, 'row')]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The organizations of a field: the ones it is taught on, whose files show beside the list, and
 * the sealed ones, which this page names for the person whose they are and shows nothing else
 * of. Their files open only for the final test.
 */
export function Organizations({ view }: { view: FieldView }) {
  const [chosen, setChosen] = useState(0);
  const open = view.organizations[chosen] ?? view.organizations[0];
  const name = (org: TaughtOn) => org.name ?? 'Its records';
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <Card title="Organizations" flush>
        {view.organizations.map((org, index) => (
          <CardRow
            key={org.id ?? 'data'}
            icon={
              <Tile>
                <Building2 strokeWidth={1.8} aria-hidden />
              </Tile>
            }
            title={name(org)}
            detail={holds(org)}
            end="Taught on"
            selected={org === open}
            onClick={() => setChosen(index)}
          />
        ))}
        {view.sealed.map((org) => (
          <CardRow
            key={org.name}
            icon={
              <Tile>
                <Lock strokeWidth={1.8} aria-hidden />
              </Tile>
            }
            title={org.name}
            detail={[kindWord(org.synthetic), plural(org.files, 'file')].join(' · ')}
            end="Never seen"
          />
        ))}
        {view.sealed.length > 0 && (
          <Quiet className="border-t border-line pb-4 pt-3 text-small">
            Never seen: sealed in the vault, away from teaching, and opened once for the final test.
          </Quiet>
        )}
      </Card>
      {open && (
        <Card title={name(open)} flush>
          {open.files.length === 0 ? (
            <Quiet>No files yet</Quiet>
          ) : (
            open.files.map((file) => (
              <CardRow
                key={file.name}
                title={<span className="font-mono text-small">{file.name}</span>}
                end={file.rows === null ? formatBytes(file.bytes) : plural(file.rows, 'row')}
              />
            ))
          )}
        </Card>
      )}
    </div>
  );
}
