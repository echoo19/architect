import { useEffect, useState, type ReactNode } from 'react';
import {
  CLUSTER_TEMPLATE_WORDING,
  type ClusterTarget,
  type ModelConfigRead,
  type TrainingPlan,
  type WrittenTrainBundle,
} from '@architect/shared';
import { Badge, Button, Card, CardRow, ChoiceTiles } from '@architect/ui';
import { Container, FolderInput, FolderOutput, Server, TriangleAlert } from 'lucide-react';
import { flowApi } from '../api/client';
import { computeApi } from '../api/compute';
import { CopyButton } from '../components/CopyButton';
import { attempt } from '../lib/notify';
import { bundleBlocker, planRequest, type PlanSettings } from './model';

function Tile({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 items-center justify-center rounded-control bg-selected">
      {children}
    </span>
  );
}

const icon = { size: 16, strokeWidth: 1.7, 'aria-hidden': true } as const;

/**
 * A launch bundle for Slurm or Kubernetes, written from the plan with a field export's verified
 * demonstrations, and the command that submits it with the person's own tools. Experimental.
 */
export function BundleCard({
  read,
  plan,
  settings,
}: {
  read: ModelConfigRead | null;
  plan: TrainingPlan | null;
  settings: PlanSettings;
}) {
  const [target, setTarget] = useState<ClusterTarget>('slurm');
  const [exportDir, setExportDir] = useState<string | null>(null);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<WrittenTrainBundle | null>(null);

  const choose = async (title: string, set: (dir: string) => void) => {
    const [folder] =
      (await attempt("Couldn't open the folder", () =>
        flowApi.pickFiles({ title, directory: true }),
      )) ?? [];
    if (folder !== undefined) set(folder);
  };

  // A bundle written for another plan no longer matches what is on screen.
  useEffect(() => setWritten(null), [read, settings]);

  const blocker = bundleBlocker(read, plan !== null && plan.fit !== null, {
    exportDir,
    parentDir,
  });

  const write = async () => {
    if (read === null || exportDir === null || parentDir === null) return;
    setWriting(true);
    const result = await attempt("Couldn't write the bundle", () =>
      computeApi.bundle({ plan: planRequest(read, settings), target, exportDir, parentDir }),
    );
    setWriting(false);
    if (result) setWritten(result);
  };

  const command = written ? `cd "${written.dir}"\n${written.bundle.submit}` : null;

  return (
    <Card title="Bundle" flush action={<Badge>Experimental</Badge>}>
      <div className="px-6 pb-5">
        <ChoiceTiles<ClusterTarget>
          aria-label="Target"
          columns={2}
          value={target}
          onValueChange={(next) => {
            setTarget(next);
            setWritten(null);
          }}
          options={[
            { value: 'slurm', label: 'Slurm', icon: <Server aria-hidden /> },
            { value: 'kubernetes', label: 'Kubernetes', icon: <Container aria-hidden /> },
          ]}
        />
      </div>
      <CardRow
        icon={
          <Tile>
            <FolderInput {...icon} />
          </Tile>
        }
        title="Field export"
        detail={<span className="font-mono">{exportDir ?? 'None chosen'}</span>}
        end={
          <Button
            size="sm"
            onClick={() => void choose('Choose a field export', (dir) => setExportDir(dir))}
          >
            Choose
          </Button>
        }
      />
      <CardRow
        icon={
          <Tile>
            <FolderOutput {...icon} />
          </Tile>
        }
        title="Write in"
        detail={<span className="font-mono">{parentDir ?? 'None chosen'}</span>}
        end={
          <Button
            size="sm"
            onClick={() =>
              void choose('Choose where to write the bundle', (dir) => setParentDir(dir))
            }
          >
            Choose
          </Button>
        }
      />
      <div className="flex items-center justify-end gap-4 border-t border-line px-6 py-4">
        {blocker && <span className="text-ui">{blocker}</span>}
        <Button
          variant="primary"
          size="md"
          disabled={blocker !== null}
          loading={writing}
          onClick={() => void write()}
        >
          Write bundle
        </Button>
      </div>
      {written && command && (
        <section
          aria-label="Submit command"
          className="flex flex-col gap-3 border-t border-line px-6 py-5"
        >
          <p className="m-0 text-ui">
            Wrote {written.files.length} files. Submit them with your own tools:
          </p>
          <div className="flex items-center gap-3 rounded-control bg-field py-2 pl-4 pr-2 shadow-edge">
            <pre className="m-0 min-w-0 flex-1 select-text whitespace-pre-wrap break-all py-1 font-mono text-small leading-6">
              {command}
            </pre>
            <CopyButton text={command} label="Copy command" />
          </div>
        </section>
      )}
      <div className="flex items-start gap-3 border-t border-line px-6 py-4 text-ui">
        <TriangleAlert size={16} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0" />
        <p className="m-0">
          Never submitted by Architect and never run on a cluster. {CLUSTER_TEMPLATE_WORDING}
        </p>
      </div>
    </Card>
  );
}
