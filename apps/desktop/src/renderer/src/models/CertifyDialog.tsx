import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_CERTIFY_SIZE,
  type Certification,
  type CertifyRequest,
  type FieldView,
  type JobSummary,
} from '@architect/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  Progress,
  Select,
  Skeleton,
} from '@architect/ui';
import { CircleAlert, Clock, ListChecks, MapPin, Repeat } from 'lucide-react';
import { api } from '../api/client';
import { graduatesApi } from '../api/graduates';
import { toError, useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { NumberRow } from '../experiments/NumberRow';
import { shortDate } from '../flow/format';
import { aboutUsd, formatAbout } from '../flow/define/estimates';
import { Certificate } from '../flow/report/Certificate';
import { shortModelName } from '../lib/names';
import { attempt } from '../lib/notify';
import { fieldOf, type ModelRow } from './registry';

/** How often an open dialog reads a running certification again. */
const POLL_MS = 1_500;

export const certificationsKey = (row: ModelRow) => `certifications:${row.key}`;

interface Settings {
  jobId: string | undefined;
  size: number | undefined;
  k: number | undefined;
  wrong: number | undefined;
  confidence: number | undefined;
  hours: number | undefined;
  check: string[];
}

/**
 * The job whose tasks a version is certified on, unless the person picks another: the newest
 * job of its field other than the one its run taught it on, whose tasks it has all seen.
 */
function defaultJob(row: ModelRow, jobs: readonly JobSummary[]): string | undefined {
  const own = row.report?.jobId;
  const field = jobs
    .filter((job) => job.name === fieldOf(row.version) && job.id !== own)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return field[0]?.id ?? own ?? jobs[0]?.id;
}

/**
 * The organizations a certified bound can be checked at: each the job is taught on, by id, and
 * each it seals, by name, which is all the app knows of one.
 */
function checkPlaces(field: FieldView): { key: string; name: string }[] {
  return [
    ...field.organizations.flatMap((org) =>
      org.id === null || org.name === null ? [] : [{ key: org.id, name: org.name }],
    ),
    ...field.sealed.map((org) => ({ key: org.name, name: org.name })),
  ];
}

function requestOf(row: ModelRow, settings: Settings): CertifyRequest | null {
  const { jobId, size, k, wrong, confidence, hours } = settings;
  if (
    jobId === undefined ||
    size === undefined ||
    k === undefined ||
    wrong === undefined ||
    confidence === undefined ||
    hours === undefined
  ) {
    return null;
  }
  return {
    graduateId: row.agent.id,
    version: row.version.version,
    jobId,
    k,
    epsilon: wrong / 100,
    delta: (100 - confidence) / 100,
    size,
    check: settings.check,
    maxUsd: 0,
    maxMinutes: Math.max(1, Math.round(hours * 60)),
  };
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-ui text-pretty">
      <span className="mt-0.5 flex shrink-0 [&_svg]:size-[15px]">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function tasks(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

/** What a planned certification will do, line by line, before anything spends. */
function PlanLines({ certification }: { certification: Certification }) {
  const { plan, request, version } = certification;
  return (
    <ul aria-label="What it will do" className="m-0 flex list-none flex-col gap-3 p-0">
      <Line icon={<ListChecks aria-hidden strokeWidth={1.8} />}>
        {tasks(plan.calibration)} of {plan.jobName} that version {version} never saw
      </Line>
      {plan.checks.length > 0 && (
        <Line icon={<MapPin aria-hidden strokeWidth={1.8} />}>
          Checked at{' '}
          {plan.checks.map((check) => `${check.orgName} (${tasks(check.tasks)})`).join(', ')}
        </Line>
      )}
      <Line icon={<Repeat aria-hidden strokeWidth={1.8} />}>
        {plan.attempts} tries, {request.k} at each task,{' '}
        {plan.target === 'local' ? 'on this computer' : `on ${shortModelName(plan.student)}`}
      </Line>
      <Line icon={<Clock aria-hidden strokeWidth={1.8} />}>
        {formatAbout(plan.seconds)} · {plan.usd === 0 ? 'Free' : aboutUsd(plan.usd)}
      </Line>
    </ul>
  );
}

/**
 * Certify a frozen version after the fact (decision 079): the settings and the tasks' job, what
 * it will cost before anything spends, its progress, then its certificate. Closing the dialog
 * leaves a running certification running.
 */
export function CertifyDialog({ row, onClose }: { row: ModelRow; onClose: () => void }) {
  const number = row.version.version;
  const history = useQuery(certificationsKey(row), () =>
    graduatesApi.certifications(row.agent.id, number),
  );
  const { reload } = history;
  // Setting up a new one, or following the one it started, or else the newest that ran.
  const [settingUp, setSettingUp] = useState(false);
  const [planned, setPlanned] = useState<Certification | null>(null);
  const [followed, setFollowed] = useState<Certification | null>(null);
  const ran = history.data?.find((item) => item.status !== 'planned');
  const shown = followed
    ? (history.data?.find((item) => item.id === followed.id) ?? followed)
    : ran;
  const running = !settingUp && shown?.status === 'certifying';

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  const start = async (certification: Certification) => {
    setFollowed(await graduatesApi.startCertification(certification.id));
    setPlanned(null);
    setSettingUp(false);
    reload();
  };

  const title = `Certify version ${number}`;
  if (history.status === 'loading' && history.data === undefined) {
    return (
      <Shell title={title} onClose={onClose}>
        <Skeleton className="mx-6 mt-4 h-24" />
      </Shell>
    );
  }
  if (settingUp || shown === undefined) {
    return (
      <SetUp
        row={row}
        title={title}
        planned={planned}
        onPlanned={setPlanned}
        onBack={async () => {
          if (planned !== null) await graduatesApi.discardCertification(planned.id);
          setPlanned(null);
        }}
        onStart={start}
        onClose={onClose}
      />
    );
  }
  const again = () => {
    setSettingUp(true);
    setPlanned(null);
  };
  if (shown.status === 'finished' && shown.certificate !== undefined) {
    return (
      <Shell title={title} onClose={onClose} wide again={again}>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-6">
          <Certificate certificate={shown.certificate} name={row.agent.name} />
        </div>
      </Shell>
    );
  }
  const share = shown.plan.attempts === 0 ? 0 : shown.done / shown.plan.attempts;
  return (
    <Shell title={title} onClose={onClose}>
      <div className="flex flex-col gap-5 px-6 pt-4">
        <PlanLines certification={shown} />
        <div className="flex flex-col gap-2">
          <Progress
            label="Certifying"
            value={share}
            valueText={`${shown.done} of ${shown.plan.attempts} tries`}
          />
          <span className="text-small tabular-nums">
            {shown.done} of {shown.plan.attempts} tries
          </span>
        </div>
        {shown.status === 'paused' && (
          <div className="flex items-start gap-3 text-ui text-pretty">
            <CircleAlert
              size={15}
              strokeWidth={1.8}
              className="mt-0.5 shrink-0 text-danger"
              aria-hidden
            />
            <span>{shown.error ?? 'It paused.'}</span>
          </div>
        )}
      </div>
      {shown.status === 'paused' && (
        <div className="flex justify-end px-6 pt-4">
          <Button size="md" onClick={() => void attempt("Couldn't resume it", () => start(shown))}>
            Resume
          </Button>
        </div>
      )}
    </Shell>
  );
}

/**
 * The dialog around each stage. A filed certificate takes the large size, tall enough for its
 * checks, and its section's own heading stands for the title.
 */
function Shell({
  title,
  wide = false,
  again,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  again?: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={title}
        hideTitle={wide}
        size={wide ? 'lg' : 'md'}
        className={wide ? 'flex h-auto max-h-[calc(100vh-48px)] flex-col' : undefined}
      >
        {children}
        <DialogFooter>
          {again && (
            <Button size="md" onClick={again}>
              Certify again
            </Button>
          )}
          <DialogClose asChild>
            <Button size="md" variant={again ? 'primary' : undefined}>
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetUp({
  row,
  title,
  planned,
  onPlanned,
  onBack,
  onStart,
  onClose,
}: {
  row: ModelRow;
  title: string;
  planned: Certification | null;
  onPlanned: (certification: Certification) => void;
  onBack: () => Promise<void>;
  onStart: (certification: Certification) => Promise<void>;
  onClose: () => void;
}) {
  const jobs = useQuery('jobs', () => api.jobs());
  const [settings, setSettings] = useState<Settings>({
    jobId: undefined,
    size: DEFAULT_CERTIFY_SIZE,
    k: 5,
    wrong: 10,
    confidence: 95,
    hours: 24,
    check: [],
  });
  const jobId = settings.jobId ?? (jobs.data ? defaultJob(row, jobs.data) : undefined);
  const field = useQuery(`field:${jobId ?? ''}`, () =>
    jobId === undefined ? Promise.resolve(null) : api.field(jobId),
  );
  const places = useMemo(() => (field.data ? checkPlaces(field.data) : []), [field.data]);
  const { check } = settings;
  const request = requestOf(row, { ...settings, jobId });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Error | null>(null);
  const set = (patch: Partial<Settings>) => {
    setSettings((now) => ({ ...now, ...patch }));
    setProblem(null);
  };

  const review = async () => {
    if (request === null) return;
    setBusy(true);
    try {
      onPlanned(await graduatesApi.planCertification(request));
    } catch (error) {
      setProblem(toError(error));
    } finally {
      setBusy(false);
    }
  };
  const begin = async () => {
    if (planned === null) return;
    setBusy(true);
    try {
      await onStart(planned);
    } catch (error) {
      setProblem(toError(error));
    } finally {
      setBusy(false);
    }
  };

  const jobOptions = (jobs.data ?? []).map((job) => ({
    value: job.id,
    label:
      (jobs.data ?? []).filter((other) => other.name === job.name).length > 1
        ? `${job.name} · ${shortDate(job.createdAt)}`
        : job.name,
  }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} description="On tasks its run never saw. Nothing is retrained.">
        {planned ? (
          <div className="flex flex-col gap-4 px-6 pt-5">
            <PlanLines certification={planned} />
          </div>
        ) : (
          <div className="flex flex-col px-6 pt-4">
            <div className="flex min-h-11 items-center gap-3 text-ui">
              <span className="min-w-0 flex-1 truncate font-medium">Tasks from</span>
              <Select
                aria-label="Tasks from"
                value={jobId}
                onValueChange={(value) => set({ jobId: value, check: [] })}
                options={jobOptions}
                className="w-56"
              />
            </div>
            <NumberRow
              label="Calibration tasks"
              value={settings.size}
              onChange={(size) => set({ size })}
              integer
              min={1}
              max={2000}
            />
            <NumberRow
              label="Tries per task"
              value={settings.k}
              onChange={(k) => set({ k })}
              integer
              min={1}
              max={9}
            />
            <NumberRow
              label="Wrong at most"
              value={settings.wrong}
              onChange={(wrong) => set({ wrong })}
              unit="%"
              min={1}
              max={99}
            />
            <NumberRow
              label="Confidence"
              value={settings.confidence}
              onChange={(confidence) => set({ confidence })}
              unit="%"
              min={1}
              max={99}
            />
            <NumberRow
              label="Time limit"
              value={settings.hours}
              onChange={(hours) => set({ hours })}
              unit="h"
              min={0.1}
              max={1000}
            />
            {places.length > 0 && (
              <fieldset className="m-0 mt-2 flex flex-col gap-2.5 border-0 border-t border-line p-0 pt-3">
                <legend className="float-left mb-2 w-full text-ui font-medium">Check at</legend>
                {places.map((place) => (
                  <Checkbox
                    key={place.key}
                    label={place.name}
                    checked={check.includes(place.key)}
                    onCheckedChange={(on) =>
                      set({
                        check: on
                          ? [...check, place.key]
                          : check.filter((key) => key !== place.key),
                      })
                    }
                  />
                ))}
              </fieldset>
            )}
          </div>
        )}
        {problem && (
          <div className="px-6 pt-4">
            <ProblemState layout="inline" error={problem} title="Can't certify it this way" />
          </div>
        )}
        <DialogFooter>
          {planned ? (
            <Button size="md" disabled={busy} onClick={() => void onBack()}>
              Back
            </Button>
          ) : (
            <DialogClose asChild>
              <Button size="md">Cancel</Button>
            </DialogClose>
          )}
          {planned ? (
            <Button variant="primary" size="md" loading={busy} onClick={() => void begin()}>
              Certify
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={request === null}
              onClick={() => void review()}
            >
              Review
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
