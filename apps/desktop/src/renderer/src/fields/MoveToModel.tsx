import { useState, type ReactNode } from 'react';
import type { FieldView, Job, StudentEndpoint } from '@architect/shared';
import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from '@architect/ui';
import { ArrowRightLeft, GitBranch, Layers, ListChecks, Lock } from 'lucide-react';
import { api, flowApi } from '../api/client';
import { useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { attempt } from '../lib/notify';
import { shortModelName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { localModelName, studentFromChoice } from '../settings/models/connections';
import { ModelPicker } from '../settings/models/ModelPicker';
import { nextVersionName } from './TeachOn';

/*
 * Carrying a field to another model (decision 094): the person picks any model connected here,
 * and the field's next version starts on it from everything the field has. The agent in use
 * keeps its model until the person switches it.
 */

/** The version a move carries, as the dialog names it: "Academy desk v2". */
export interface CarriedVersion {
  graduateId: string;
  version: number;
  name: string;
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-ui text-pretty">
      <span className="mt-0.5 flex shrink-0 [&_svg]:size-[15px]">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

const CARRIED = 'instructions, helpers, retrieval and verified lessons';

/** What it starts from: the version named, the one in use, or the field's starting setup. */
function startsFrom(from: CarriedVersion | undefined, trained: boolean): string {
  if (from) return `Starts from ${from.name}'s ${CARRIED}, and the field's counterexamples.`;
  return trained
    ? `Starts from the ${CARRIED} of the version in use, and the field's counterexamples.`
    : "Starts from the field's starting setup, since no version of it has been trained yet.";
}

/**
 * Asks which model the field moves to and says what carries over and what stays sealed, then
 * makes the new version and opens it.
 */
export function MoveToModelDialog({
  view,
  job,
  from,
  trained,
  onClose,
}: {
  /** The newest version of the field, where the move is made. */
  view: FieldView;
  job: Job;
  /** The version whose harness it carries, when one was chosen. */
  from?: CarriedVersion;
  /** Whether a version of the field was trained, whose harness the engine carries by default. */
  trained: boolean;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<{ endpoint: StudentEndpoint; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const next = nextVersionName(job.name, view.versionOf);
  const current = shortModelName(job.student.label);
  const sealed = view.sealed.map((org) => org.name);

  const move = async () => {
    if (choice === null) return;
    setBusy(true);
    const made = await attempt(`Couldn't move ${job.name} to ${choice.label}`, () =>
      flowApi.moveToModel(view.jobId, {
        student: choice.endpoint,
        label: choice.label,
        ...(from ? { from: { graduateId: from.graduateId, version: from.version } } : {}),
      }),
    );
    setBusy(false);
    if (!made) return;
    onClose();
    navigate(paths.field(made.jobId));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Move to another model">
        <div className="flex flex-col gap-5 px-6 pt-5">
          <section aria-label="New model" className="flex flex-col gap-2">
            <h3 className="m-0 text-small font-medium">New model</h3>
            <ModelPicker
              role="student"
              aria-label="New model"
              current={choice?.endpoint ?? null}
              onChoose={(picked) =>
                setChoice({
                  endpoint: studentFromChoice(picked, job.student.local.contextLength),
                  label: shortModelName(localModelName(picked.id)),
                })
              }
              className="w-full"
            >
              <span className="truncate">{choice?.label ?? 'Choose a model'}</span>
            </ModelPicker>
          </section>
          <ul aria-label="What carries over" className="m-0 flex list-none flex-col gap-3 p-0">
            <Line icon={<GitBranch aria-hidden strokeWidth={1.8} />}>
              Makes {next}, a new version of the field on {choice?.label ?? 'that model'}.{' '}
              {job.name} stays as it is.
            </Line>
            <Line icon={<Layers aria-hidden strokeWidth={1.8} />}>{startsFrom(from, trained)}</Line>
            <Line icon={<ListChecks aria-hidden strokeWidth={1.8} />}>
              Keeps the same practice tasks, check tasks, checker and study.
            </Line>
            <Line icon={<Lock aria-hidden strokeWidth={1.8} />}>
              {sealed.length === 0
                ? 'The final test stays sealed exactly as it is.'
                : `The final test and ${listed(sealed)} stay never seen, sealed exactly as they are.`}
            </Line>
            <Line icon={<ArrowRightLeft aria-hidden strokeWidth={1.8} />}>
              The agent in use keeps answering on {current} until you switch it.
            </Line>
          </ul>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button
            size="md"
            variant="primary"
            loading={busy}
            disabled={choice === null}
            onClick={() => void move()}
          >
            {choice ? `Move to ${choice.label}` : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The newest version of a field, following each version to the one made from it. */
async function newestField(jobId: string): Promise<{ view: FieldView; job: Job }> {
  let view = await api.field(jobId);
  for (const seen = new Set([jobId]); view.nextVersion && !seen.has(view.nextVersion.jobId);) {
    seen.add(view.nextVersion.jobId);
    view = await api.field(view.nextVersion.jobId);
  }
  return { view, job: await api.job(view.jobId) };
}

/**
 * The move from a version's panel in Models: it carries that version, made at the newest version
 * of its field, where a field's next version is always made.
 */
export function MoveVersionDialog({
  jobId,
  from,
  onClose,
}: {
  jobId: string;
  from: CarriedVersion;
  onClose: () => void;
}) {
  const field = useQuery(`field-newest:${jobId}`, () => newestField(jobId), {
    refreshOnMount: true,
  });
  if (field.status === 'error') {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent title="Move to another model">
          <ProblemState
            error={field.error}
            title="Couldn't read this field"
            onRetry={field.reload}
          />
        </DialogContent>
      </Dialog>
    );
  }
  if (!field.data) return null;
  return (
    <MoveToModelDialog
      view={field.data.view}
      job={field.data.job}
      from={from}
      trained
      onClose={onClose}
    />
  );
}
