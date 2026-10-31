import { useState, type ReactNode } from 'react';
import type { FieldView } from '@architect/shared';
import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from '@architect/ui';
import { BookOpen, GitBranch, History, Lock, ScanSearch } from 'lucide-react';
import { flowApi } from '../api/client';
import { navigate, paths } from '../lib/router';
import { attempt } from '../lib/notify';

/** The name the next version of a field takes: "Academy desk v2", then "Academy desk v3". */
export function nextVersionName(name: string, versionOf: FieldView['versionOf']): string {
  return `${name.replace(/ v\d+$/, '')} v${(versionOf?.version ?? 1) + 1}`;
}

/** The newer version of a field that teaches on one of its sealed organizations, if any. */
export function newerVersion(view: FieldView): { jobId: string; name: string } | null {
  return view.sealed.find((org) => org.taughtIn !== undefined)?.taughtIn ?? null;
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

/**
 * Asks before a never-seen organization is taught on (decision 089), saying exactly what changes
 * and what stays as measured, then opens the new version of the field on its organizations.
 */
export function TeachOnDialog({
  view,
  jobName,
  org,
  teacher,
  onClose,
}: {
  /** The field the organization is sealed in. */
  view: FieldView;
  jobName: string;
  org: string;
  /** The teacher's short name, as the app shows it. */
  teacher: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const next = nextVersionName(jobName, view.versionOf);
  const others = view.sealed.filter((item) => item.name !== org && item.taughtIn === undefined);
  const real = others.filter((item) => !item.synthetic);

  const teach = async () => {
    setBusy(true);
    const made = await attempt(`Couldn't teach on ${org}`, () => flowApi.teachOn(view.jobId, org));
    setBusy(false);
    if (!made) return;
    onClose();
    navigate(paths.field(made.jobId, 'organizations'));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={`Teach on ${org}?`}>
        <ul aria-label="What changes" className="m-0 flex list-none flex-col gap-3 px-6 pt-5">
          <Line icon={<GitBranch aria-hidden strokeWidth={1.8} />}>
            Makes {next}, a new version of the field. {jobName} stays as it is.
          </Line>
          <Line icon={<BookOpen aria-hidden strokeWidth={1.8} />}>
            {org}&rsquo;s files become material {teacher} may read, and its tasks become practice
            and check tasks.
          </Line>
          <Line icon={<Lock aria-hidden strokeWidth={1.8} />}>
            {others.length === 0
              ? 'No never-seen organization is left in the new version. Seal a fresh cohort or add one to keep testing on work it never saw.'
              : `${listed(others.map((item) => item.name))} ${others.length === 1 ? 'stays' : 'stay'} never seen, sealed again for its final test.${real.length === 0 ? ' None of them is real: seal a fresh cohort or add a real one.' : ''}`}
          </Line>
          <Line icon={<History aria-hidden strokeWidth={1.8} />}>
            What was measured on {org} stays as it was, marked measured before it was taught on.
          </Line>
          <Line icon={<ScanSearch aria-hidden strokeWidth={1.8} />}>
            {teacher} studies the field again before {next} trains.
          </Line>
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button size="md" variant="primary" loading={busy} onClick={() => void teach()}>
            Teach on it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
