import { useEffect, useState } from 'react';
import {
  type ClusterTarget,
  type ModelConfigRead,
  type TrainingPlan,
  type WrittenTrainBundle,
} from '@architect/shared';
import {
  Badge,
  Button,
  Card,
  CardRow,
  ChoiceTiles,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  RowIcon,
} from '@architect/ui';
import { ChevronDown, FolderInput, FolderOutput, TriangleAlert } from 'lucide-react';
import { flowApi } from '../api/client';
import { computeApi } from '../api/compute';
import { CopyButton } from '../components/CopyButton';
import { useFieldExports, useSessionExports, type FieldExport } from '../fields/exports';
import { shortPath } from '../lib/format';
import { attempt } from '../lib/notify';
import { bundleBlocker, planRequest, type PlanSettings } from './model';
import { CLUSTERS } from './Targets';

const CLUSTER_TARGETS = CLUSTERS.map(({ target, name, icon }) => ({
  value: target,
  label: name,
  icon,
}));

const icon = { size: 16, strokeWidth: 1.7, 'aria-hidden': true } as const;

/** What a cluster bundle is and isn't, once and short (docs/SCALE.md). */
export const CLUSTER_NOTE =
  'Architect writes this bundle and never submits it. It is checked against simulated schedulers only; GPU runs, large models and training gains are unverified.';

/** The fields exported from the app, each offering the folder of its latest export. */
function LatestExport({
  exports,
  onPick,
}: {
  exports: readonly FieldExport[];
  onPick: (dir: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          Use the latest export of…
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {exports.map((item) => (
          <DropdownMenuItem key={item.jobId} onSelect={() => onPick(item.dir)}>
            {item.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A launch bundle for Slurm, Kubernetes or SkyPilot, written from the plan with a field export's
 * verified demonstrations, and the command that submits it with the person's own tools.
 * Experimental. It starts from the latest export of the field it is planned for, or the newest
 * of any; one recorded before a restart is chosen again before it is read.
 */
export function BundleCard({
  read,
  plan,
  settings,
  jobId,
}: {
  read: ModelConfigRead | null;
  plan: TrainingPlan | null;
  settings: PlanSettings;
  jobId: string | null;
}) {
  const [target, setTarget] = useState<ClusterTarget>('slurm');
  const exports = useFieldExports();
  const choose = useSessionExports((state) => state.choose);
  const [picked, setPicked] = useState<string | null>(null);
  const exportDir =
    picked ?? (exports.find((item) => item.jobId === jobId) ?? exports[0])?.dir ?? null;
  const exported = exports.find((item) => item.dir === exportDir);
  // A folder chosen on this card is ready; a recorded one only once chosen since the restart.
  const exportReady = exported?.ready ?? true;
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<WrittenTrainBundle | null>(null);

  const pickFolder = async (title: string, set: (dir: string) => void, defaultPath?: string) => {
    const [folder] =
      (await attempt("Couldn't open the folder", () =>
        flowApi.pickFiles({
          title,
          directory: true,
          ...(defaultPath === undefined ? {} : { defaultPath }),
        }),
      )) ?? [];
    if (folder !== undefined) set(folder);
  };
  const pickExport = (dir: string) => {
    choose(dir);
    setPicked(dir);
  };

  // A bundle written for another plan no longer matches what is on screen.
  useEffect(() => setWritten(null), [read, settings]);

  const blocker = bundleBlocker(read, plan !== null && plan.fit !== null, {
    exportDir,
    exportReady,
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
          columns={3}
          value={target}
          onValueChange={(next) => {
            setTarget(next);
            setWritten(null);
          }}
          options={CLUSTER_TARGETS}
        />
      </div>
      <CardRow
        icon={
          <RowIcon>
            <FolderInput {...icon} />
          </RowIcon>
        }
        title={exported ? `Field export of ${exported.name}` : 'Field export'}
        detail={
          <span className="font-mono" title={exportDir ?? undefined}>
            {exportDir === null ? 'None chosen' : shortPath(exportDir)}
          </span>
        }
        end={
          <span className="flex items-center gap-2">
            {exports.length > 0 && <LatestExport exports={exports} onPick={setPicked} />}
            {exported && !exported.ready ? (
              <Button
                size="sm"
                onClick={() =>
                  void pickFolder(
                    `Choose the export of ${exported.name} again`,
                    pickExport,
                    exported.dir,
                  )
                }
              >
                Choose again
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void pickFolder('Choose a field export', pickExport)}
              >
                Choose
              </Button>
            )}
          </span>
        }
      />
      <CardRow
        icon={
          <RowIcon>
            <FolderOutput {...icon} />
          </RowIcon>
        }
        title="Write in"
        detail={
          <span className="font-mono" title={parentDir ?? undefined}>
            {parentDir === null ? 'None chosen' : shortPath(parentDir)}
          </span>
        }
        end={
          <Button
            size="sm"
            onClick={() =>
              void pickFolder('Choose where to write the bundle', (dir) => setParentDir(dir))
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
            Wrote {written.files.length} files in{' '}
            <span className="font-mono text-small" title={written.dir}>
              {shortPath(written.dir)}
            </span>
            . From that folder, submit them with your own tools:
          </p>
          <div className="flex items-center gap-3 rounded-control bg-field py-2 pl-4 pr-2 shadow-edge">
            <pre className="m-0 min-w-0 flex-1 select-text whitespace-pre-wrap break-all py-1 font-mono text-small leading-6">
              {written.bundle.submit}
            </pre>
            <CopyButton text={command} label="Copy command" />
          </div>
        </section>
      )}
      <div className="flex items-start gap-3 border-t border-line px-6 py-4 text-ui">
        <TriangleAlert size={16} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0" />
        <p className="m-0">{CLUSTER_NOTE}</p>
      </div>
    </Card>
  );
}
