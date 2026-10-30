import { useState, type ReactNode } from 'react';
import type { FieldExportManifest } from '@architect/shared';
import { Button, Card, CardGrid, CardRow, Skeleton, toast } from '@architect/ui';
import { FolderOutput, Gauge, Lock, MessagesSquare } from 'lucide-react';
import { api, flowApi } from '../api/client';
import { useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { shortPath } from '../lib/format';
import { attempt } from '../lib/notify';
import { count, plural, Quiet, Tile } from './parts';

/** What can be said of an export, in the words of docs/SCALE.md and decision 071. */
const WORDING =
  'Checker-verified training examples from this field. No model has been trained on them here: GPU execution, large models and training gains are unverified.';

function Figure({ children }: { children: ReactNode }) {
  return <span className="font-display text-h2 font-semibold tabular-nums">{children}</span>;
}

/**
 * The field's assets as an export would hold them now, built and checked by the engine with
 * nothing written: its verified demonstrations, its outcome scorer and its sealed evaluation by
 * hash only, and what it leaves out. Export writes them to an empty folder the person picks.
 */
export function Assets({ jobId }: { jobId: string }) {
  const assets = useQuery(`fieldAssets:${jobId}`, () => api.fieldAssets(jobId));
  if (!assets.data) {
    return assets.status === 'error' ? (
      <ProblemState
        error={assets.error}
        title="Couldn't count this field's assets"
        onRetry={assets.reload}
      />
    ) : (
      <Skeleton aria-busy="true" className="h-48 rounded-card" />
    );
  }
  return <AssetsView jobId={jobId} manifest={assets.data} />;
}

function AssetsView({ jobId, manifest }: { jobId: string; manifest: FieldExportManifest }) {
  const [exporting, setExporting] = useState(false);
  const { counts } = manifest;

  const exportTo = async () => {
    setExporting(true);
    const [folder] =
      (await attempt("Couldn't open the folder dialog", () =>
        flowApi.pickFiles({ title: 'Choose an empty folder for the export', directory: true }),
      )) ?? [];
    if (folder !== undefined) {
      const written = await attempt("Couldn't export the field", () =>
        flowApi.exportField(jobId, folder),
      );
      if (written) {
        toast({
          title: 'Field exported',
          description: `${shortPath(folder)}: ${plural(written.counts.demonstrations, 'demonstration')}, the scorer and the sealed manifest.`,
        });
      }
    }
    setExporting(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-8">
        <p className="m-0 max-w-[620px] text-body text-pretty">{WORDING}</p>
        <Button variant="primary" size="md" loading={exporting} onClick={() => void exportTo()}>
          {!exporting && <FolderOutput size={15} strokeWidth={1.7} aria-hidden />}
          Export
        </Button>
      </div>
      <CardGrid>
        <Card title="Field export" flush>
          <CardRow
            icon={
              <Tile>
                <MessagesSquare strokeWidth={1.8} aria-hidden />
              </Tile>
            }
            title="Verified demonstrations"
            detail={`From train tasks only, ${plural(counts.trained_turns, 'checked turn')}`}
            end={<Figure>{count(counts.demonstrations)}</Figure>}
          />
          <CardRow
            icon={
              <Tile>
                <Gauge strokeWidth={1.8} aria-hidden />
              </Tile>
            }
            title="Outcome scorer"
            detail={`Train tasks at ${plural(counts.train_organizations, 'organization')}, with the checker and a Python client`}
            end={<Figure>{count(counts.train_tasks)}</Figure>}
          />
          <CardRow
            icon={
              <Tile>
                <Lock strokeWidth={1.8} aria-hidden />
              </Tile>
            }
            title="Never-seen evaluation"
            detail={`Final-test tasks and ${plural(counts.sealed_organizations, 'never-seen organization')}, by hash only`}
            end={<Figure>{count(counts.locked_test_tasks)}</Figure>}
          />
        </Card>
        <Card title="Left out" flush>
          {manifest.left_out.length === 0 ? (
            <Quiet>Nothing</Quiet>
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {manifest.left_out.map((entry) => (
                <li
                  key={entry.what}
                  className="flex flex-col gap-0.5 border-t border-line px-6 py-3 text-ui"
                >
                  <span className="font-medium">{entry.what}</span>
                  <span className="text-small text-pretty">{entry.why}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </CardGrid>
    </div>
  );
}
