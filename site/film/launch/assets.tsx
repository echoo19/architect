import { Card, CardRow, RowIcon } from '@architect/ui';
import { ArrowRight, Bug, Check, Lock } from 'lucide-react';
import { ACADEMY } from '../lab/data';
import { Grow } from '../lab/pages-flow';
import { FieldTabs } from '../lab/pages-lab';
import { PlacePage } from '../lab/shell';
import { outQuart, rise, span } from '../lab/time';
import { KEPT_CASE } from './data';

/**
 * The field's page on its Assets tab (apps/desktop fields/Assets.tsx): the regression suite every
 * later change to a helper must pass, where the counterexample just repaired is locked in, and
 * what is left out of every export, sealed in the vault.
 */
export function FieldAssets({ lt, landAt }: { lt: number; landAt: number }) {
  const land = outQuart(span(lt, landAt, 0.6));
  return (
    <PlacePage title={ACADEMY}>
      <FieldTabs open="Assets" />
      <div className="flex flex-col gap-4">
        <div data-frame="suite">
          <Card
            title="Regression suite"
            icon={<Bug strokeWidth={1.8} aria-hidden />}
            action={
              <span className="font-display text-h2 font-semibold tabular-nums">
                {land > 0.5 ? 1 : 0}
              </span>
            }
            flush
          >
            <Grow p={1 - land} height={48}>
              <div className="flex h-12 items-center border-t border-line px-6 text-ui">
                None yet
              </div>
            </Grow>
            <Grow p={land} height={57}>
              <CardRow
                icon={
                  <RowIcon>
                    <Check strokeWidth={2} className="text-student" aria-hidden />
                  </RowIcon>
                }
                title={KEPT_CASE.title}
                detail={<span className="font-mono">{KEPT_CASE.detail}</span>}
                end={
                  <span className="inline-flex items-center gap-2 tabular-nums">
                    {KEPT_CASE.from}
                    <ArrowRight size={16} strokeWidth={2} aria-hidden />
                    {KEPT_CASE.to}
                  </span>
                }
              />
            </Grow>
          </Card>
        </div>
        <div style={rise(lt, 0.3, 6)}>
          <Card title="Left out" flush>
            <CardRow
              icon={
                <RowIcon>
                  <Lock strokeWidth={1.8} aria-hidden />
                </RowIcon>
              }
              title="2 organizations the job has never seen"
              detail="Kept in the vault with their files and tasks, for the sealed final test"
            />
          </Card>
        </div>
      </div>
    </PlacePage>
  );
}
